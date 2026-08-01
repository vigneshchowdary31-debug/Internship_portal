-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "EnrollmentEventType" AS ENUM ('ENROLLED', 'CREDENTIAL_SENT', 'CREDENTIAL_FAILED', 'CREDENTIAL_RESEND_BLOCKED', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'FIRST_LOGIN', 'ACTIVATED', 'DEACTIVATED', 'PROFILE_UPDATED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credentialFailureReason" TEXT,
ADD COLUMN     "credentialLastRetryAt" TIMESTAMP(3),
ADD COLUMN     "credentialRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credentialSentAt" TIMESTAMP(3),
ADD COLUMN     "credentialStatus" "CredentialStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "firstLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EnrollmentEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "EnrollmentEventType" NOT NULL,
    "detail" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrollmentEvent_userId_createdAt_idx" ON "EnrollmentEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrollmentEvent_type_idx" ON "EnrollmentEvent"("type");

-- CreateIndex
CREATE INDEX "EnrollmentEvent_createdAt_idx" ON "EnrollmentEvent"("createdAt");

-- CreateIndex
CREATE INDEX "User_credentialStatus_idx" ON "User"("credentialStatus");

-- CreateIndex
CREATE INDEX "User_mustChangePassword_idx" ON "User"("mustChangePassword");

-- AddForeignKey
ALTER TABLE "EnrollmentEvent" ADD CONSTRAINT "EnrollmentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentEvent" ADD CONSTRAINT "EnrollmentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backward compatibility backfill.
--
-- `credentialStatus` defaults to PENDING, which is correct for a newly enrolled
-- user awaiting their credential email. It is WRONG for every account that
-- predates the enrollment system: those users already hold working credentials
-- and were never sent one of these emails. Left at PENDING they would sit in
-- the "Pending Credentials" dashboard card forever and make the metric useless.
--
-- Any account that has already completed its password change (or never owed
-- one) is treated as delivered, stamped from createdAt as the best available
-- approximation.
-- ---------------------------------------------------------------------------
UPDATE "User"
SET "credentialStatus" = 'SENT',
    "credentialSentAt"  = COALESCE("credentialSentAt", "createdAt")
WHERE "mustChangePassword" = false;
