import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for the Submission -> Assignment delete rule.
 *
 * ── WHAT THIS CAN AND CANNOT PROVE ───────────────────────────────────────────
 * A foreign key is enforced by PostgreSQL, and the rest of this suite runs
 * against an in-memory Prisma double that has no notion of one. A mocked
 * "raw delete should fail" test would assert only that the mock was told to
 * throw — it would pass just as happily with ON DELETE CASCADE in production,
 * which is exactly the false confidence that let the original bug ship.
 *
 * So this file guards the two things that are checkable without a database,
 * and the live constraint is verified separately by
 * `npm run verify:fk` (scripts/verify-fk-constraints.ts), which reads
 * pg_constraint and attempts a real delete inside a rolled-back transaction.
 *
 * What is pinned here:
 *   1. schema.prisma declares Restrict — so a future edit cannot silently
 *      revert it, and `prisma migrate` cannot be asked to undo it by accident.
 *   2. A migration exists that actually applies RESTRICT to the live database —
 *      a schema change without one drifts, and drift on THIS constraint means
 *      production still cascades while the code says otherwise.
 */

const BACKEND_ROOT = process.cwd();
const SCHEMA = fs.readFileSync(path.join(BACKEND_ROOT, 'prisma/schema.prisma'), 'utf8');

/** The `model Submission { … }` block, isolated from the rest of the schema. */
function submissionModel(): string {
  const match = SCHEMA.match(/model Submission \{[\s\S]*?\n\}/);
  if (!match) throw new Error('Could not find `model Submission` in schema.prisma');
  return match[0];
}

describe('Submission.assignment delete rule', () => {
  it('is declared Restrict in schema.prisma', () => {
    const relation = submissionModel()
      .split('\n')
      .find((line) => line.trim().startsWith('assignment '));

    expect(relation).toBeDefined();
    expect(relation).toContain('onDelete: Restrict');
  });

  it('is NOT Cascade', () => {
    // The original defect, stated as its own assertion so a failure names the
    // actual regression rather than "expected string to contain".
    const relation = submissionModel()
      .split('\n')
      .find((line) => line.trim().startsWith('assignment '));

    expect(relation).not.toContain('onDelete: Cascade');
  });

  it('keeps the artifact relation Restrict too', () => {
    // Both halves of "student work is never silently detached from its
    // evidence". If either flips, submitted work becomes destructible again.
    const relation = submissionModel()
      .split('\n')
      .find((line) => line.trim().startsWith('asset '));

    expect(relation).toContain('onDelete: Restrict');
  });
});

describe('the change is actually applied to the database', () => {
  const MIGRATIONS = path.join(BACKEND_ROOT, 'prisma/migrations');

  it('has a migration that sets the constraint to RESTRICT', () => {
    // A schema edit with no migration means production keeps cascading while
    // the code claims it does not — the most dangerous possible outcome here.
    const sql = fs
      .readdirSync(MIGRATIONS)
      .filter((dir) => fs.existsSync(path.join(MIGRATIONS, dir, 'migration.sql')))
      .map((dir) => fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8'))
      .join('\n');

    const restrictClause =
      /ADD CONSTRAINT "Submission_assignmentId_fkey"[\s\S]*?ON DELETE RESTRICT/;

    expect(sql).toMatch(restrictClause);
  });

  it('drops the old constraint before adding the new one', () => {
    const sql = fs
      .readdirSync(MIGRATIONS)
      .filter((dir) => fs.existsSync(path.join(MIGRATIONS, dir, 'migration.sql')))
      .map((dir) => fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8'))
      .join('\n');

    // PostgreSQL cannot alter a foreign key's delete rule in place; without the
    // drop, the ADD is a no-op against the existing CASCADE constraint.
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "Submission_assignmentId_fkey"/);
  });
});
