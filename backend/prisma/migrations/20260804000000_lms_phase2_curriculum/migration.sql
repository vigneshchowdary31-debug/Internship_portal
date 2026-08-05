-- LMS Phase 2 — Curriculum Builder & Content Management.
--
-- Strictly additive: one enum value, one nullable column, one new table. No
-- existing column is altered, renamed or dropped, so every Phase 1 row stays
-- valid and a rollback to the previous application version keeps working.
--
-- IDEMPOTENT BY CONSTRUCTION. `ALTER TYPE ... ADD VALUE` cannot run inside a
-- transaction block, so PostgreSQL forces Prisma to split this file — the enum
-- change commits separately from everything below it. When a later statement
-- failed in the Phase 1 migration, that split left the enum committed while
-- Prisma still recorded the migration as failed, and the retry then died on
-- "type already exists". Every statement here is therefore safe to re-run.

-- AlterEnum: appended last so existing ContentType ordinals are untouched.
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'REFERENCE';

-- AlterTable: nullable, so existing modules need no backfill.
ALTER TABLE "Module" ADD COLUMN IF NOT EXISTS "thumbnailAssetId" TEXT;

-- CreateTable: notification fan-out (tier 2 — per-recipient read state).
CREATE TABLE IF NOT EXISTS "NotificationRecipient" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "emailFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationRecipient_userId_readAt_idx" ON "NotificationRecipient"("userId", "readAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationRecipient_userId_createdAt_idx" ON "NotificationRecipient"("userId", "createdAt");

-- CreateIndex: one row per person per event; makes fan-out re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRecipient_notificationId_userId_key" ON "NotificationRecipient"("notificationId", "userId");

-- AddForeignKey: SetNull matches Content.asset — deleting an image degrades the
-- module card to a placeholder rather than blocking the delete.
DO $$ BEGIN
    ALTER TABLE "Module" ADD CONSTRAINT "Module_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
