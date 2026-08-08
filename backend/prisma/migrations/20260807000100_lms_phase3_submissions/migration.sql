-- LMS Phase 3, Module 2 — Submissions.
--
-- Strictly additive: one new table, one new column on Assignment. No existing
-- column is altered, renamed or dropped.
--
-- The new column is NOT NULL DEFAULT true, which PostgreSQL applies to existing
-- rows without a table rewrite (since PG 11) and without a backfill step. `true`
-- rather than `false` because every assignment created before this column
-- existed was authored under the assumption that a student could hand in again;
-- defaulting to false would silently tighten a rule on live work.
--
-- IDEMPOTENT BY CONSTRUCTION, matching Phase 2 and Phase 3 M1.
--
-- No enum is created: `ASSIGNMENT_EVALUATED` already exists on NotificationType
-- from Phase 1, so there is no out-of-transaction `ALTER TYPE ... ADD VALUE`.

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "allowResubmission" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Submission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "marks" INTEGER,
    "feedback" TEXT,
    "gradedAt" TIMESTAMP(3),
    "gradedById" TEXT,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one current submission per student per assignment. Resubmission
-- replaces the artifact in place, so this is the constraint that makes "the
-- submission" unambiguous for grading rather than a race between attempts.
CREATE UNIQUE INDEX IF NOT EXISTS "Submission_assignmentId_studentId_key" ON "Submission"("assignmentId", "studentId");

-- CreateIndex: the instructor grading list, and the late-submission counts
-- Module 4 reads.
CREATE INDEX IF NOT EXISTS "Submission_assignmentId_isLate_idx" ON "Submission"("assignmentId", "isLate");

-- CreateIndex: "everything this student has handed in, most recent first".
CREATE INDEX IF NOT EXISTS "Submission_studentId_submittedAt_idx" ON "Submission"("studentId", "submittedAt");

-- CreateIndex: makes the Restrict check below an index lookup rather than a
-- sequential scan of Submission on every asset delete.
CREATE INDEX IF NOT EXISTS "Submission_assetId_idx" ON "Submission"("assetId");

-- AddForeignKey: Cascade — deleting an assignment takes its submissions. The
-- artifacts are cleaned up by SubmissionService, not by the database.
DO $$ BEGIN
    ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: Cascade, matching every other per-student row.
DO $$ BEGIN
    ALTER TABLE "Submission" ADD CONSTRAINT "Submission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: RESTRICT, deliberately unlike Content.assetId (SET NULL).
-- A content item that loses its file degrades to a placeholder; a submission
-- that loses its file is evidence that has gone missing. The database refuses.
DO $$ BEGIN
    ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: SetNull — removing an instructor must not erase the mark they
-- awarded, only who awarded it.
DO $$ BEGIN
    ALTER TABLE "Submission" ADD CONSTRAINT "Submission_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
