import 'dotenv/config';
import prisma from '../src/config/db';

/**
 * Verifies the delete rules that protect student work — against the REAL
 * database, which is the only place a foreign key exists.
 *
 * Run with:  npm run verify:fk
 *
 * The unit suite cannot do this. It runs against an in-memory Prisma double
 * with no notion of a foreign key, so a mocked "delete should fail" test would
 * pass just as happily with ON DELETE CASCADE still live in production. That is
 * precisely the false confidence that let the original cascade ship.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 * This script never commits a write.
 *
 *   Check 1     reads pg_constraint. Read-only, always safe.
 *   Checks 2-3  ATTEMPT a delete inside a transaction that is ALWAYS rolled
 *               back, whether the delete fails (proving the constraint) or
 *               succeeds (proving it is missing). Either way the rollback is
 *               unconditional, so nothing is ever removed.
 *
 * Exit codes:
 *   0  every protected relation is correct
 *   1  at least one is wrong — student work is deletable
 *   2  could not run (database unreachable)
 */

const RULE = '──────────────────────────────────────────────────────────────';

/** `confdeltype` in pg_constraint: what PostgreSQL does on parent delete. */
const DELETE_RULE: Record<string, string> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

/** The relations whose delete rule is a data-safety decision, not a detail. */
const PROTECTED = [
  {
    table: 'Submission',
    constraint: 'Submission_assignmentId_fkey',
    expected: 'RESTRICT',
    why: 'Deleting an assignment must never destroy student submissions.',
  },
  {
    table: 'Submission',
    constraint: 'Submission_assetId_fkey',
    expected: 'RESTRICT',
    why: 'A submission must never be detached from its uploaded file.',
  },
  {
    table: 'Attempt',
    constraint: 'Attempt_quizId_fkey',
    expected: 'RESTRICT',
    why: 'Deleting a quiz must never destroy student exam records.',
  },
];

async function checkConstraints(): Promise<boolean> {
  const rows = await prisma.$queryRaw<
    { table_name: string; conname: string; confdeltype: string; def: string }[]
  >`
    SELECT c.conrelid::regclass::text AS table_name,
           c.conname,
           -- Cast required: confdeltype is "char" (1-byte internal type), which
           -- Prisma's $queryRaw cannot deserialize.
           c.confdeltype::text AS confdeltype,
           pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.conname = ANY(${PROTECTED.map((p) => p.constraint)}::text[])`;

  let ok = true;

  console.log('\nCheck 1 — declared delete rules');
  console.log(RULE);

  for (const expect of PROTECTED) {
    const found = rows.find((r) => r.conname === expect.constraint);

    if (!found) {
      console.log(`  ✗ ${expect.constraint}`);
      console.log(`      MISSING. The foreign key does not exist at all.`);
      console.log(`      ${expect.why}`);
      ok = false;
      continue;
    }

    const actual = DELETE_RULE[found.confdeltype] ?? found.confdeltype;

    if (actual === expect.expected) {
      console.log(`  ✓ ${expect.constraint} — ON DELETE ${actual}`);
    } else {
      console.log(`  ✗ ${expect.constraint} — ON DELETE ${actual}, expected ${expect.expected}`);
      console.log(`      ${expect.why}`);
      console.log(`      ${found.def}`);
      ok = false;
    }
  }

  return ok;
}

/** Sentinel used to unwind a probe transaction after a delete unexpectedly succeeded. */
class Rollback extends Error {}

/**
 * Runs one delete inside a transaction that is ALWAYS rolled back, and reports
 * whether the database refused it.
 *
 * Rolls back whether the delete failed (proving the constraint) or succeeded
 * (proving it is missing), so nothing is ever removed either way.
 */
async function deleteIsRefused(remove: (tx: typeof prisma) => Promise<unknown>): Promise<boolean | null> {
  try {
    await prisma.$transaction(async (tx) => {
      await remove(tx as typeof prisma);
      // Reached only if the database ALLOWED it — the bug. Roll back and report.
      throw new Rollback('deleted');
    });
  } catch (error: any) {
    if (error instanceof Rollback) return false;
    if (error?.code === 'P2003' || /foreign key/i.test(error?.message ?? '')) return true;
    console.log(`  ? Unexpected error: ${error?.message ?? error}`);
    return null;
  }
  return false;
}

function reportProbe(blocked: boolean | null, subject: string): boolean {
  if (blocked === null) return false;
  if (blocked) {
    console.log(`  ✓ Refused by the database (foreign key violation). ${subject} are safe.`);
    return true;
  }
  console.log(`  ✗ THE DELETE SUCCEEDED. The database still cascades — ${subject} are at risk.`);
  console.log('    (Rolled back; nothing was actually removed.)');
  return false;
}

/**
 * Proves each constraint by trying to break it.
 *
 * A declared rule and an ENFORCED rule are not the same claim — a constraint
 * can exist as NOT VALID, or a migration can be recorded without applying. This
 * attempts the deletes the guards are supposed to stop.
 */
async function attemptProtectedDeletes(): Promise<boolean> {
  let ok = true;

  console.log('\nCheck 2 — an assignment WITH submissions resists deletion');
  console.log(RULE);

  const assignment = await prisma.assignment.findFirst({
    where: { submissions: { some: {} } },
    select: { id: true, title: true, _count: { select: { submissions: true } } },
  });

  if (!assignment) {
    console.log('  ⊘ Skipped: no assignment currently has any submissions.');
    console.log('    Check 1 still proves the rule is declared correctly.');
  } else {
    console.log(`  Target: "${assignment.title}" (${assignment._count.submissions} submission(s))`);
    const blocked = await deleteIsRefused((tx) =>
      tx.assignment.delete({ where: { id: assignment.id } })
    );
    ok = reportProbe(blocked, 'Submissions') && ok;
  }

  console.log('\nCheck 3 — a quiz WITH attempts resists deletion');
  console.log(RULE);

  const quiz = await prisma.quiz.findFirst({
    where: { attempts: { some: {} } },
    select: { id: true, title: true, _count: { select: { attempts: true } } },
  });

  if (!quiz) {
    console.log('  ⊘ Skipped: no quiz currently has any attempts.');
    console.log('    Check 1 still proves the rule is declared correctly.');
    return ok;
  }

  console.log(`  Target: "${quiz.title}" (${quiz._count.attempts} attempt(s))`);
  const blocked = await deleteIsRefused((tx) => tx.quiz.delete({ where: { id: quiz.id } }));
  return reportProbe(blocked, 'Attempts') && ok;
}

async function main() {
  console.log(`\n${RULE}`);
  console.log('  Foreign-key safety check — protecting submissions and attempts');
  console.log(RULE);

  const declared = await checkConstraints();
  const enforced = await attemptProtectedDeletes();

  console.log(`\n${RULE}`);
  if (declared && enforced) {
    console.log('  RESULT: safe. Student submissions and quiz attempts are protected.');
    console.log(`${RULE}\n`);
    return 0;
  }
  console.log('  RESULT: NOT SAFE. Apply the pending migration:');
  console.log('          npx prisma migrate deploy');
  console.log(`${RULE}\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('\nCould not run the check — is the database reachable?');
    console.error(error?.message ?? error);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
