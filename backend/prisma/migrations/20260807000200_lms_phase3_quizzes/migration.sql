-- LMS Phase 3, Module 3 — Quizzes.
--
-- Strictly additive: three new tables. No existing table, column, enum or
-- constraint is altered, so Phase 1/2 and Phase 3 M1/M2 rows all stay valid.
--
-- IDEMPOTENT BY CONSTRUCTION, matching every earlier LMS migration.
--
-- No enum is created: `VisibilityScope` and the `QUIZ_PUBLISHED` value of
-- `NotificationType` both already exist from Phase 1, so this file needs no
-- out-of-transaction `ALTER TYPE ... ADD VALUE`.
--
-- NOTE ON "one open attempt per student per quiz": that rule is enforced in
-- QuizService, not by a partial unique index. PostgreSQL supports
-- `... WHERE "submittedAt" IS NULL`, but Prisma's schema language does not, so
-- the index would be invisible to the schema and every subsequent
-- `prisma migrate dev` would generate a migration to drop it. An enforced-in-code
-- rule that survives the next migration beats a database rule that silently
-- disappears on the next one.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Quiz" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "learningPathId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "timeLimit" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "scope" "VisibilityScope" NOT NULL DEFAULT 'LEARNING_PATH',
    "batchId" TEXT,
    "maxAttempts" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Question" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Attempt" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answers" JSONB,
    "score" INTEGER,
    "totalMarks" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "autoSubmitted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the student-facing "published quizzes in this module" read.
CREATE INDEX IF NOT EXISTS "Quiz_moduleId_isPublished_idx" ON "Quiz"("moduleId", "isPublished");

-- CreateIndex: the "everything across my curriculum" read, and the derived
-- quiz-progress denominator.
CREATE INDEX IF NOT EXISTS "Quiz_learningPathId_isPublished_idx" ON "Quiz"("learningPathId", "isPublished");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quiz_batchId_idx" ON "Quiz"("batchId");

-- CreateIndex: questions are always fetched for one quiz, in render order.
CREATE INDEX IF NOT EXISTS "Question_quizId_position_idx" ON "Question"("quizId", "position");

-- CreateIndex: the attempt-count and open-attempt lookups, both keyed on the
-- pair rather than either column alone.
CREATE INDEX IF NOT EXISTS "Attempt_quizId_studentId_idx" ON "Attempt"("quizId", "studentId");

-- CreateIndex: "this student's attempts, and which are still open".
CREATE INDEX IF NOT EXISTS "Attempt_studentId_submittedAt_idx" ON "Attempt"("studentId", "submittedAt");

-- AddForeignKey: Cascade — deleting a module deletes its quizzes.
DO $$ BEGIN
    ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: SetNull — removing the author must not delete the quiz.
DO $$ BEGIN
    ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: Cascade — a question has no meaning outside its quiz.
DO $$ BEGIN
    ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey: Cascade. Unlike Submission — whose artifact is Restrict
-- because a file is evidence that must not vanish — an attempt carries no
-- external object, so deleting the quiz can take its attempts with it.
DO $$ BEGIN
    ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
