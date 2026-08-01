-- AlterTable
ALTER TABLE "User" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "niatId" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "techStackId" TEXT,
ADD COLUMN     "universityName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_niatId_key" ON "User"("niatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_techStackId_idx" ON "User"("techStackId");

-- CreateIndex
CREATE INDEX "User_status_role_idx" ON "User"("status", "role");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_techStackId_fkey" FOREIGN KEY ("techStackId") REFERENCES "TechStack"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backward compatibility backfill.
--
-- `mustChangePassword` defaults to true so that newly ENROLLED users are forced
-- through the one-time password change. Every row that already exists at the
-- moment this migration runs belongs to a user who set their own password, so
-- they must NOT be locked out of the dashboard on their next login.
--
-- passwordChangedAt is stamped from updatedAt as the best available
-- approximation of when the account was last modified.
-- ---------------------------------------------------------------------------
UPDATE "User"
SET "mustChangePassword" = false,
    "passwordChangedAt"  = COALESCE("passwordChangedAt", "updatedAt")
WHERE "mustChangePassword" = true;
