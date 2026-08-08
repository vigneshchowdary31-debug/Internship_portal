-- Attempt.quizId: ON DELETE CASCADE -> ON DELETE RESTRICT.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- An Attempt is a student's exam record: the answers they gave, when they gave
-- them, and what it scored. Cascade meant deleting one quiz erased every
-- attempt against it — the identical defect Submission.assignmentId had, and
-- the identical fix.
--
-- QuizService.remove already refuses to delete a quiz with attempts and says
-- why. This is the backstop for everything that does not go through it: raw
-- SQL, Prisma Studio, a seed script, or a future code path that forgets.
--
-- ── NO DATA IS TOUCHED ───────────────────────────────────────────────────────
-- Changing a foreign key's delete rule rewrites catalog metadata, not rows.
-- Every existing Attempt already satisfies this exact key, so the validation
-- scan PostgreSQL runs on ADD CONSTRAINT cannot fail and cannot alter anything.
--
-- ── ATOMICITY ────────────────────────────────────────────────────────────────
-- DROP and ADD are one pair inside the single transaction Prisma wraps each
-- migration in, so there is no committed moment where the column is
-- unconstrained and a concurrent delete cannot slip through the gap.
--
-- ── REVERSIBILITY ────────────────────────────────────────────────────────────
-- Prisma has no down-migrations. To reverse:
--
--   ALTER TABLE "Attempt" DROP CONSTRAINT "Attempt_quizId_fkey";
--   ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizId_fkey"
--     FOREIGN KEY ("quizId") REFERENCES "Quiz"("id")
--     ON DELETE CASCADE ON UPDATE CASCADE;
--
-- and set `onDelete: Cascade` back on Attempt.quiz in schema.prisma.

-- DropForeignKey
ALTER TABLE "Attempt" DROP CONSTRAINT IF EXISTS "Attempt_quizId_fkey";

-- AddForeignKey: RESTRICT. Deleting a Quiz that still has attempts now raises
-- foreign_key_violation (SQLSTATE 23503) instead of erasing them.
DO $$ BEGIN
    ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
