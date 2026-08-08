-- Submission.assignmentId: ON DELETE CASCADE -> ON DELETE RESTRICT.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- Cascade meant deleting one assignment destroyed every submission against it:
-- the marks, the feedback, and the link to each student's uploaded file. The
-- Cloudinary objects survived with nothing referencing them, invisible even to
-- the admin orphan report, which only lists assets that still have a MediaAsset
-- row. AssignmentService.remove and ModuleService.remove already refuse this
-- with a readable message; this constraint is the backstop for everything that
-- does not go through them — raw SQL, Prisma Studio, seed scripts, future code.
--
-- ── NO DATA IS TOUCHED ───────────────────────────────────────────────────────
-- Changing a foreign key's delete rule rewrites catalog metadata, not rows.
-- Every existing Submission already satisfies this exact key (it was inserted
-- under it), so the validation scan PostgreSQL runs on ADD CONSTRAINT cannot
-- fail and cannot alter anything.
--
-- ── ATOMICITY ────────────────────────────────────────────────────────────────
-- DROP and ADD are one statement pair inside the single transaction Prisma
-- wraps each migration in. There is no committed moment where the column is
-- unconstrained, so a concurrent delete cannot slip through the gap. The ADD
-- takes a brief ACCESS EXCLUSIVE lock on "Submission" while it validates;
-- on a table of this size that is milliseconds.
--
-- ── REVERSIBILITY ────────────────────────────────────────────────────────────
-- Prisma has no down-migrations. To reverse, run:
--
--   ALTER TABLE "Submission" DROP CONSTRAINT "Submission_assignmentId_fkey";
--   ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey"
--     FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
--     ON DELETE CASCADE ON UPDATE CASCADE;
--
-- and set `onDelete: Cascade` back on Submission.assignment in schema.prisma.
-- Reversing loses nothing, because nothing was lost going forward.
--
-- ── IDEMPOTENT ───────────────────────────────────────────────────────────────
-- Matching every earlier LMS migration: safe to re-run. IF EXISTS on the drop,
-- and the add is guarded against a duplicate name.

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_assignmentId_fkey";

-- AddForeignKey: RESTRICT. Deleting an Assignment that still has submissions
-- now raises foreign_key_violation (SQLSTATE 23503) instead of erasing them.
DO $$ BEGIN
    ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
