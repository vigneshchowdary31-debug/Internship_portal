import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import prisma from '../src/config/db';
import { toCsv } from '../src/utils/csv';

/**
 * Pre-flight gate for the LMS migrations.
 *
 * Run with:  npm run lms:preflight
 *
 * ── The constraint that shapes this entire file ───────────────────────────
 * This script runs BEFORE `prisma migrate deploy`. The database is therefore
 * in whatever state the LAST APPLIED migration left it — which is NOT the
 * state described by prisma/schema.prisma.
 *
 * Two consequences, both of which caused real bugs in the first version:
 *
 *   1. Any column added by M1 (Batch.createdAt, Batch.learningPathId,
 *      StudentBatch.assignedAt) does not exist yet. Referencing one fails with
 *      PostgreSQL 42703.
 *
 *   2. Prisma Client is GENERATED FROM THE CURRENT SCHEMA, so a bare
 *      `prisma.batch.findMany()` selects every column the schema declares —
 *      including the ones M1 has not created yet. Using Prisma Client is not
 *      automatically safe here: every query below uses an EXPLICIT `select`
 *      naming only columns that exist in the database right now.
 *
 * Schema state is detected once, up front, by querying information_schema.
 * That is the one place raw SQL is genuinely required — there is no Prisma
 * model for the catalog. Everything else uses Prisma Client.
 *
 * Exit codes:
 *   0  safe — migrations may proceed
 *   1  blocked — a problem needs a human decision; cleanup CSV written
 *   2  could not run (database unreachable)
 */

const RULE = '──────────────────────────────────────────────────────────────';

// Columns present in the baseline schema, before any LMS migration.
// Every pre-M1 query is restricted to these.
const PRE_M1_BATCH_SELECT = { id: true, name: true, techStackId: true } as const;

interface SchemaState {
  /** M1 applied: LearningPath table exists and Batch.learningPathId is present. */
  lmsFoundationApplied: boolean;
  /** M2 applied: the one-batch-per-student unique index exists. */
  singleBatchApplied: boolean;
}

/**
 * Detects what the database actually looks like right now.
 *
 * Explicit detection rather than try/catch around each query: catching an
 * exception cannot distinguish "this column does not exist yet" from "the
 * query is wrong", and the first version silently swallowed both.
 */
async function detectSchemaState(): Promise<SchemaState> {
  const [batchColumns, indexes] = await Promise.all([
    prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Batch';
    `,
    prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'StudentBatch';
    `,
  ]);

  return {
    lmsFoundationApplied: batchColumns.some((c) => c.column_name === 'learningPathId'),
    singleBatchApplied: indexes.some((i) => i.indexname === 'StudentBatch_studentId_key'),
  };
}

interface MultiBatchStudent {
  studentId: string;
  name: string;
  email: string;
  niatId: string | null;
  batchCount: number;
  batches: string[];
}

/**
 * Students belonging to more than one batch — the blocker for M2.
 *
 * Runs on baseline columns only (`studentId`, `batchId`, `Batch.name`), so it
 * is valid both before and after M1.
 */
async function findMultiBatchStudents(): Promise<MultiBatchStudent[]> {
  const grouped = await prisma.studentBatch.groupBy({
    by: ['studentId'],
    _count: { batchId: true },
    having: { batchId: { _count: { gt: 1 } } },
  });

  if (grouped.length === 0) return [];

  const studentIds = grouped.map((g) => g.studentId);

  const [users, memberships] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, email: true, niatId: true },
    }),
    prisma.studentBatch.findMany({
      where: { studentId: { in: studentIds } },
      // Explicit select: Batch has only these three columns before M1.
      select: { studentId: true, batch: { select: PRE_M1_BATCH_SELECT } },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const batchesByStudent = new Map<string, string[]>();
  for (const m of memberships) {
    const list = batchesByStudent.get(m.studentId) ?? [];
    list.push(m.batch.name);
    batchesByStudent.set(m.studentId, list);
  }

  return grouped
    .map((g) => {
      const user = userById.get(g.studentId);
      return {
        studentId: g.studentId,
        name: user?.name ?? '(unknown user)',
        email: user?.email ?? '',
        niatId: user?.niatId ?? null,
        batchCount: g._count.batchId,
        batches: (batchesByStudent.get(g.studentId) ?? []).sort((a, b) => a.localeCompare(b)),
      };
    })
    .sort((a, b) => b.batchCount - a.batchCount || a.name.localeCompare(b.name));
}

/** Batches with no curriculum assigned. Only meaningful once M1 has run. */
async function findUnpinnedBatches() {
  return prisma.batch.findMany({
    where: { learningPathId: null },
    select: PRE_M1_BATCH_SELECT,
    orderBy: { name: 'asc' },
  });
}

/**
 * Batches whose learning path belongs to a DIFFERENT tech stack.
 *
 * The service layer maintains this invariant on every write; this verifies it
 * held. Prisma cannot compare two columns in a `where`, so the comparison is
 * done in memory — batch counts are in the tens, and correctness beats a raw
 * query that would need re-auditing against the schema.
 */
async function findPathMismatches() {
  const batches = await prisma.batch.findMany({
    where: { learningPathId: { not: null } },
    select: {
      id: true,
      name: true,
      techStackId: true,
      techStack: { select: { name: true } },
      learningPath: {
        select: { id: true, name: true, version: true, techStackId: true },
      },
    },
  });

  return batches.filter((b) => b.learningPath && b.learningPath.techStackId !== b.techStackId);
}

/**
 * Learning paths that would render as an empty course, or that nothing uses.
 *
 * Advisory only — a freshly created path legitimately has neither modules nor
 * batches yet. Reported so an admin notices a curriculum nobody can see.
 */
async function findQuestionablePaths() {
  const paths = await prisma.learningPath.findMany({
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      techStack: { select: { name: true } },
      _count: { select: { modules: true, batches: true } },
    },
    orderBy: [{ name: 'asc' }, { version: 'asc' }],
  });

  return {
    empty: paths.filter((p) => p._count.modules === 0),
    unused: paths.filter((p) => p._count.batches === 0),
  };
}

function writeCleanupReport(students: MultiBatchStudent[]): string {
  const csv = toCsv(
    ['Student Name', 'Email', 'NIAT ID', 'Batch Count', 'Current Batches', 'Keep Which Batch?'],
    students.map((s) => [
      s.name,
      s.email,
      s.niatId ?? '',
      s.batchCount,
      s.batches.join(' | '),
      '', // blank on purpose — a human decides
    ])
  );

  const outPath = path.resolve(process.cwd(), 'multi-batch-students.csv');
  fs.writeFileSync(outPath, csv, 'utf8');
  return outPath;
}

async function main() {
  console.log(`\n${RULE}`);
  console.log('🔍 LMS Pre-flight');
  console.log(RULE);

  let state: SchemaState;
  try {
    state = await detectSchemaState();
  } catch (error: any) {
    console.error('\n❌ Could not reach the database.');
    console.error(`   ${error?.message || error}`);
    console.error('\n   Migrations were NOT attempted.');
    console.log(`${RULE}\n`);
    process.exit(2);
  }

  console.log(`\nSchema state`);
  console.log(`  lms_foundation (M1) : ${state.lmsFoundationApplied ? '✅ applied' : '⬜ not applied'}`);
  console.log(`  lms_single_batch (M2): ${state.singleBatchApplied ? '✅ applied' : '⬜ not applied'}`);
  console.log(
    state.lmsFoundationApplied
      ? '  → All checks will run.'
      : '  → Curriculum checks are skipped; those tables do not exist yet.'
  );

  let blocked = false;

  // ---- Check 1: one batch per student (always runs) ----
  console.log(`\n${RULE}`);
  console.log('1. Students in multiple batches');

  const multiBatch = await findMultiBatchStudents();

  if (multiBatch.length === 0) {
    if (state.singleBatchApplied) {
      console.log('   ✅ None — and the unique constraint is already enforcing it.');
    } else {
      console.log('   ✅ None. The lms_single_batch migration is safe to apply.');
    }
  } else {
    blocked = true;
    const total = multiBatch.reduce((sum, s) => sum + s.batchCount, 0);
    const reportPath = writeCleanupReport(multiBatch);

    console.error(`   ❌ ${multiBatch.length} student(s) belong to more than one batch.`);
    console.error(`      ${total} memberships must be reduced to ${multiBatch.length}.\n`);
    console.error(`      ${'Name'.padEnd(24)} ${'Email'.padEnd(28)} ${'#'.padEnd(3)} Batches`);
    console.error(`      ${'-'.repeat(24)} ${'-'.repeat(28)} ${'-'.repeat(3)} ${'-'.repeat(28)}`);
    multiBatch.slice(0, 20).forEach((s) => {
      console.error(
        `      ${s.name.slice(0, 24).padEnd(24)} ${s.email.slice(0, 28).padEnd(28)} ` +
          `${String(s.batchCount).padEnd(3)} ${s.batches.join(' | ')}`
      );
    });
    if (multiBatch.length > 20) {
      console.error(`      … and ${multiBatch.length - 20} more (see the CSV).`);
    }
    console.error(`\n      📄 Cleanup report: ${reportPath}`);
    console.error('\n      To resolve:');
    console.error('        1. Fill in "Keep Which Batch?" for each student — this is an');
    console.error('           academic decision, so the script will not guess it.');
    console.error('        2. In the portal, open Batches → the batch to remove them from,');
    console.error('           and un-assign the student there.');
    console.error('        3. Re-run `npm run lms:preflight`.');
  }

  // ---- Checks 2–4: curriculum integrity (only once M1 exists) ----
  if (state.lmsFoundationApplied) {
    console.log(`\n${RULE}`);
    console.log('2. Batches without a Learning Path');
    const unpinned = await findUnpinnedBatches();
    if (unpinned.length === 0) {
      console.log('   ✅ Every batch has a curriculum assigned.');
    } else {
      blocked = true;
      console.error(`   ❌ ${unpinned.length} batch(es) have no Learning Path:`);
      unpinned.forEach((b) => console.error(`      · ${b.name}`));
      console.error('      The M1 backfill should have covered these. Assign a curriculum');
      console.error('      in Admin → Curriculum before students use the LMS.');
    }

    console.log(`\n${RULE}`);
    console.log('3. TechStack ↔ LearningPath mismatches');
    const mismatched = await findPathMismatches();
    if (mismatched.length === 0) {
      console.log('   ✅ Every batch runs a path from its own tech stack.');
    } else {
      blocked = true;
      console.error(`   ❌ ${mismatched.length} batch(es) point at a path from another tech stack:`);
      mismatched.forEach((b) =>
        console.error(
          `      · "${b.name}" (${b.techStack.name}) → "${b.learningPath!.name} ${b.learningPath!.version}"`
        )
      );
    }

    console.log(`\n${RULE}`);
    console.log('4. Learning Path health');
    const { empty, unused } = await findQuestionablePaths();
    if (empty.length === 0 && unused.length === 0) {
      console.log('   ✅ All learning paths have modules and are in use.');
    } else {
      // Advisory: a new path legitimately has neither yet.
      if (empty.length > 0) {
        console.warn(`   ⚠️  ${empty.length} path(s) contain no modules:`);
        empty.forEach((p) => console.warn(`      · ${p.name} ${p.version} (${p.techStack.name})`));
        console.warn('      Students on these would see an empty course.');
      }
      if (unused.length > 0) {
        console.warn(`   ⚠️  ${unused.length} path(s) are not used by any batch:`);
        unused.forEach((p) => console.warn(`      · ${p.name} ${p.version} (${p.status})`));
      }
      console.warn('      These are warnings, not blockers.');
    }
  }

  // ---- Verdict ----
  console.log(`\n${RULE}`);
  if (blocked) {
    console.error('❌ BLOCKED — resolve the issues above, then re-run.');
    console.error('   Migrations were NOT attempted.');
    console.log(`${RULE}\n`);
    process.exit(1);
  }

  console.log('✅ PASSED — safe to run `npx prisma migrate deploy`.');
  console.log(`${RULE}\n`);
  process.exit(0);
}

main()
  .catch((error) => {
    console.error('\nUnexpected pre-flight failure:', error);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
