-- LMS Phase 3, Module 1 — Assignments.
--
-- Strictly additive: one new table and four indexes. No existing table, column,
-- enum or constraint is altered, so every Phase 1/2 row stays valid and rolling
-- the application back to the previous version leaves a harmless empty table
-- behind rather than a broken schema.
--
-- IDEMPOTENT BY CONSTRUCTION, matching the Phase 2 migration: `ALTER TYPE` and
-- multi-statement DDL can leave a partially-applied migration recorded as
-- failed, and the retry then dies on "already exists". Every statement here is
-- safe to re-run.
--
-- No enum is created: `VisibilityScope` and the `ASSIGNMENT_PUBLISHED` value of
-- `NotificationType` both already exist from Phase 1, which is why this file
-- needs no out-of-transaction `ALTER TYPE ... ADD VALUE` at all.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Assignment" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "learningPathId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "scope" "VisibilityScope" NOT NULL DEFAULT 'LEARNING_PATH',
    "batchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the student-facing read — "published work in this module, by due
-- date". Column order matches the query's equality-then-range shape.
CREATE INDEX IF NOT EXISTS "Assignment_moduleId_isPublished_deadline_idx" ON "Assignment"("moduleId", "isPublished", "deadline");

-- CreateIndex: the "everything due across my curriculum" read.
CREATE INDEX IF NOT EXISTS "Assignment_learningPathId_isPublished_idx" ON "Assignment"("learningPathId", "isPublished");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Assignment_batchId_idx" ON "Assignment"("batchId");

-- CreateIndex: due-date filtering and the upcoming-deadlines sort.
CREATE INDEX IF NOT EXISTS "Assignment_deadline_idx" ON "Assignment"("deadline");

-- AddForeignKey: Cascade — deleting a module deletes its work. ModuleService
-- already refuses to delete a module that still holds content, so this cascade
-- is reachable only for a module the admin has deliberately emptied.
DO $$ BEGIN
    ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: Cascade, matching Content.learningPath.
DO $$ BEGIN
    ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: Cascade, matching Content.batch — a batch-scoped assignment
-- has no meaning once the batch is gone.
DO $$ BEGIN
    ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: SetNull — removing the author must never delete the work.
DO $$ BEGIN
    ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
