-- ===========================================================================
-- CreateEnum (idempotent)
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so Prisma
-- splits this file at that point. On the first attempt everything above the
-- split COMMITTED before the migration failed further down, which left these
-- nine types (and the three enum values below) already present in the database.
--
-- PostgreSQL has no `CREATE TYPE IF NOT EXISTS`, so each is guarded by a DO
-- block that swallows ONLY `duplicate_object`. Any other error still aborts the
-- migration. This makes the file safe to re-run against the half-applied
-- database AND correct against a fresh one — no manual cleanup either way.
-- ===========================================================================

DO $$ BEGIN
    CREATE TYPE "BatchStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "LearningPathStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ModuleDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ContentType" AS ENUM ('PDF', 'PPT', 'DOCX', 'GITHUB_REPO', 'RECORDING', 'LINK', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "VisibilityScope" AS ENUM ('LEARNING_PATH', 'BATCH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "StorageProvider" AS ENUM ('CLOUDINARY', 'SUPABASE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "NotificationType" AS ENUM ('NOTES_UPLOADED', 'VIDEO_UPLOADED', 'RECORDING_UPLOADED', 'ASSIGNMENT_PUBLISHED', 'QUIZ_PUBLISHED', 'PROJECT_PUBLISHED', 'ASSIGNMENT_EVALUATED', 'PROJECT_EVALUATED', 'QUIZ_EVALUATED', 'DUE_DATE_REMINDER', 'UPCOMING_SESSION', 'ANNOUNCEMENT', 'BATCH_TRANSFERRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "NotificationAudience" AS ENUM ('INDIVIDUAL', 'BATCH', 'LEARNING_PATH', 'TECH_STACK', 'ROLE', 'BROADCAST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterEnum (idempotent)
--
-- These three values also committed on the first attempt. `IF NOT EXISTS` is
-- supported from PostgreSQL 12 onward; this database is 17.6.
--
-- These statements are why Prisma splits the file: `ALTER TYPE ... ADD VALUE`
-- cannot execute inside a transaction block.
ALTER TYPE "EnrollmentEventType" ADD VALUE IF NOT EXISTS 'BATCH_ASSIGNED';
ALTER TYPE "EnrollmentEventType" ADD VALUE IF NOT EXISTS 'BATCH_TRANSFERRED';
ALTER TYPE "EnrollmentEventType" ADD VALUE IF NOT EXISTS 'BATCH_REMOVED';

-- AlterTable
ALTER TABLE "TechStack" ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- `@updatedAt` is maintained by Prisma Client, so schema.prisma expects NO
-- database default. The default above exists solely to backfill the existing
-- rows (adding a NOT NULL column with no default to a populated table is what
-- failed with 23502 on the first attempt). Dropping it immediately leaves the
-- column identical to what Prisma expects, so `migrate diff` reports no drift.
ALTER TABLE "TechStack" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "learningPathId" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Same reasoning as TechStack above: backfill the existing row, then remove the
-- default so the column matches schema.prisma exactly.
ALTER TABLE "Batch" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StudentBatch" ADD COLUMN     "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "LearningPath" (
    "id" TEXT NOT NULL,
    "techStackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "status" "LearningPathStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "clonedFromId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "learningPathId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "estimatedDurationMinutes" INTEGER,
    "difficulty" "ModuleDifficulty",
    "originId" TEXT,
    "aiMetadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModulePrerequisite" (
    "moduleId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,

    CONSTRAINT "ModulePrerequisite_pkey" PRIMARY KEY ("moduleId","prerequisiteId")
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "learningPathId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ContentType" NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "scope" "VisibilityScope" NOT NULL DEFAULT 'LEARNING_PATH',
    "batchId" TEXT,
    "overridesId" TEXT,
    "releaseAt" TIMESTAMP(3),
    "assetId" TEXT,
    "externalUrl" TEXT,
    "originId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "provider" "StorageProvider" NOT NULL DEFAULT 'CLOUDINARY',
    "providerKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentProgress" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "secondsSpent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContentProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "batchId" TEXT,
    "learningPathId" TEXT,
    "techStackId" TEXT,
    "targetRole" "Role",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningPath_techStackId_status_idx" ON "LearningPath"("techStackId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPath_techStackId_version_key" ON "LearningPath"("techStackId", "version");

-- CreateIndex
CREATE INDEX "Module_learningPathId_position_idx" ON "Module"("learningPathId", "position");

-- CreateIndex
CREATE INDEX "Module_learningPathId_isVisible_idx" ON "Module"("learningPathId", "isVisible");

-- CreateIndex
CREATE INDEX "Module_originId_idx" ON "Module"("originId");

-- CreateIndex
CREATE INDEX "ModulePrerequisite_prerequisiteId_idx" ON "ModulePrerequisite"("prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Content_overridesId_key" ON "Content"("overridesId");

-- CreateIndex
CREATE INDEX "Content_moduleId_status_position_idx" ON "Content"("moduleId", "status", "position");

-- CreateIndex
CREATE INDEX "Content_learningPathId_status_idx" ON "Content"("learningPathId", "status");

-- CreateIndex
CREATE INDEX "Content_batchId_idx" ON "Content"("batchId");

-- CreateIndex
CREATE INDEX "Content_releaseAt_idx" ON "Content"("releaseAt");

-- CreateIndex
CREATE INDEX "Content_originId_idx" ON "Content"("originId");

-- CreateIndex
CREATE INDEX "MediaAsset_uploadedById_idx" ON "MediaAsset"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_provider_providerKey_key" ON "MediaAsset"("provider", "providerKey");

-- CreateIndex
CREATE INDEX "ContentProgress_studentId_lastViewedAt_idx" ON "ContentProgress"("studentId", "lastViewedAt");

-- CreateIndex
CREATE INDEX "ContentProgress_contentId_idx" ON "ContentProgress"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProgress_studentId_contentId_key" ON "ContentProgress"("studentId", "contentId");

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_batchId_idx" ON "Notification"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "TechStack_code_key" ON "TechStack"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_code_key" ON "Batch"("code");

-- CreateIndex
CREATE INDEX "Batch_learningPathId_idx" ON "Batch"("learningPathId");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "LearningPath"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPath" ADD CONSTRAINT "LearningPath_techStackId_fkey" FOREIGN KEY ("techStackId") REFERENCES "TechStack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPath" ADD CONSTRAINT "LearningPath_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "LearningPath"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPath" ADD CONSTRAINT "LearningPath_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModulePrerequisite" ADD CONSTRAINT "ModulePrerequisite_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModulePrerequisite" ADD CONSTRAINT "ModulePrerequisite_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_overridesId_fkey" FOREIGN KEY ("overridesId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProgress" ADD CONSTRAINT "ContentProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProgress" ADD CONSTRAINT "ContentProgress_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- LEGACY LEARNING PATH BACKFILL
--
-- Every existing Batch predates LearningPath and therefore has no curriculum
-- version. Left NULL they would be invisible to every LMS query, so one
-- "Legacy" path is created per TechStack and every existing batch is pinned to
-- the path belonging to its own tech stack.
--
-- This is the ONLY data write in the entire LMS migration set. It is
-- idempotent-safe (guarded by NOT EXISTS) and fully discarded by a rollback,
-- because rollback drops both the column and the table.
--
-- gen_random_uuid() is available in PostgreSQL 13+ without an extension, which
-- Supabase provides.
-- ===========================================================================

INSERT INTO "LearningPath" ("id", "techStackId", "name", "version", "description", "status", "isDefault", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    ts."id",
    ts."name" || ' (Legacy)',
    'v1',
    'Auto-created during the LMS migration so pre-existing batches keep a valid curriculum. Safe to rename.',
    'PUBLISHED',
    true,
    NOW(),
    NOW()
FROM "TechStack" ts
WHERE NOT EXISTS (
    SELECT 1 FROM "LearningPath" lp
    WHERE lp."techStackId" = ts."id" AND lp."version" = 'v1'
);

UPDATE "Batch" b
SET "learningPathId" = lp."id"
FROM "LearningPath" lp
WHERE lp."techStackId" = b."techStackId"
  AND lp."version" = 'v1'
  AND b."learningPathId" IS NULL;
