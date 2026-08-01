-- Credential reset flow: two new enum values.
--
-- Purely additive. No column is altered, no row is rewritten, and no existing
-- value is removed — PostgreSQL cannot drop an enum value that rows may
-- reference, so the deprecated CREDENTIAL_RESEND_BLOCKED is deliberately kept.
--
-- NOTE on transactions: `ALTER TYPE ... ADD VALUE` may run inside a transaction
-- on PostgreSQL 12+, but the newly added value cannot be USED in that same
-- transaction. This migration only declares the values; the first code path to
-- write RESET_SENT runs in a later transaction, so there is no conflict.
-- Supabase runs PostgreSQL 15+, so no special handling is required.

-- AlterEnum
ALTER TYPE "CredentialStatus" ADD VALUE 'RESET_SENT';

-- AlterEnum
ALTER TYPE "EnrollmentEventType" ADD VALUE 'CREDENTIAL_GENERATED';

