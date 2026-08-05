-- ===========================================================================
-- ONE ACTIVE BATCH PER STUDENT
--
-- ⚠️  THIS IS THE ONLY MIGRATION IN THE LMS SET THAT CAN FAIL.
--
-- It fails if ANY student currently belongs to two or more batches. That is a
-- data problem, not a schema problem, and it must be resolved by a human —
-- choosing which batch a student belongs to is an academic decision, not one a
-- migration should make silently.
--
-- BEFORE APPLYING, RUN:
--     npm run lms:preflight
--
-- That command reports every multi-batch student and writes a cleanup CSV. It
-- exits 0 only when the data is safe. The deploy pipeline should read:
--     npm run lms:preflight && npx prisma migrate deploy
--
-- The DO block below is a second line of defence: it raises a readable error
-- instead of letting PostgreSQL emit a bare unique-violation, so an operator
-- who skipped the pre-flight still learns exactly what is wrong.
-- ===========================================================================

DO $$
DECLARE
    offending_count INTEGER;
    sample TEXT;
BEGIN
    SELECT COUNT(*) INTO offending_count
    FROM (
        SELECT "studentId" FROM "StudentBatch" GROUP BY "studentId" HAVING COUNT(*) > 1
    ) dupes;

    IF offending_count > 0 THEN
        SELECT string_agg(u.email, ', ')
          INTO sample
          FROM (
            SELECT "studentId" FROM "StudentBatch" GROUP BY "studentId" HAVING COUNT(*) > 1 LIMIT 5
          ) d
          JOIN "User" u ON u.id = d."studentId";

        RAISE EXCEPTION
            'Cannot enforce one-batch-per-student: % student(s) belong to multiple batches (e.g. %). Run "npm run lms:preflight" for the full cleanup report, resolve each case, then re-run this migration.',
            offending_count, COALESCE(sample, 'n/a');
    END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "StudentBatch_studentId_key" ON "StudentBatch"("studentId");
