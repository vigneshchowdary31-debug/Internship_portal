# LMS Phase 1 — Completion Report

**Project:** Student Training Portal → Internship LMS
**Phase:** 1 of 3 — Database, Backend, API, Permissions, Modules, Learning Content
**Date:** 1 August 2026
**Status:** 🟢 **Code complete. Migrations generated, NOT applied.** Awaiting your approval for Phase 2.

**Design reference:** [LMS_ARCHITECTURE.md](LMS_ARCHITECTURE.md) (v2)

---

## VERIFICATION SUMMARY

| Check | Result |
|---|---|
| backend `tsc --noEmit` | ✅ 0 errors |
| backend `npm test` | ✅ **177 passed** / 11 files (was 166) |
| frontend `tsc --noEmit` | ✅ 0 errors |
| frontend `vite build` | ✅ built in 550 ms |
| frontend `oxlint` | ✅ 0 errors |
| `prisma validate` | ✅ schema valid |
| Migration split lossless | ✅ **66 statements in = 65 (M1) + 1 (M2), 0 missing, 0 extra** |
| Migrations applied to a database | ⛔ **Not applied — see §7** |
| Runtime / browser testing | ⛔ **Not performed — see §9** |

---

## 1. DATABASE MIGRATION SUMMARY

Two new migrations, bringing the set to six.

```
backend/prisma/migrations/
├── 20260731000000_baseline
├── 20260731000100_enrollment_fields
├── 20260731000200_credential_management
├── 20260731000300_credential_reset_flow
├── 20260801000000_lms_foundation      ← NEW (M1)
└── 20260801000100_lms_single_batch    ← NEW (M2)
```

### M1 — `lms_foundation`

| | Count |
|---|---|
| Tables created | 7 |
| Enums created | 9 |
| Indexes created | 23 |
| Columns added to existing tables | 13 (`TechStack` 6, `Batch` 6, `StudentBatch` 1) |
| Data statements | 2 (the legacy-path backfill) |
| Destructive statements | **0** |

**The backfill** — the only data write in the entire LMS migration set:

```sql
-- One "Legacy" learning path per existing tech stack…
INSERT INTO "LearningPath" (…)
SELECT gen_random_uuid(), ts."id", ts."name" || ' (Legacy)', 'v1', …
FROM "TechStack" ts
WHERE NOT EXISTS (SELECT 1 FROM "LearningPath" lp
                  WHERE lp."techStackId" = ts."id" AND lp."version" = 'v1');

-- …then pin every existing batch to its own stack's path.
UPDATE "Batch" b SET "learningPathId" = lp."id"
FROM "LearningPath" lp
WHERE lp."techStackId" = b."techStackId" AND lp."version" = 'v1'
  AND b."learningPathId" IS NULL;
```

Guarded by `NOT EXISTS`, so re-running is safe. Without it every existing batch would have a null curriculum and be invisible to every LMS query.

### M2 — `lms_single_batch`

One statement — `CREATE UNIQUE INDEX "StudentBatch_studentId_key"` — plus a `DO $$` guard that raises a **readable** error naming the offending students, rather than letting PostgreSQL emit a bare unique-violation to an operator who skipped the pre-flight.

**This is the only migration in the set that can fail.**

---

## 2. PRISMA MODEL CHANGES

### New models (7)

| Model | Purpose |
|---|---|
| `LearningPath` | Versioned curriculum. Cloning it is what makes syllabus changes migration-free |
| `Module` | A unit within a path. Carries duration, difficulty, `originId` lineage |
| `ModulePrerequisite` | Self-M:N graph. **Stored but not enforced**, per decision 7 |
| `Content` | Notes / PPT / DOCX / repo / recording / link / video |
| `MediaAsset` | Provider-agnostic file record |
| `ContentProgress` | Objective consumption — split view/download/open counters |
| `Notification` | Tier 1 of the notification model; tiers 2–3 land in Phase 3 |

### New enums (9)

`BatchStatus` · `LearningPathStatus` · `ModuleDifficulty` · `ContentType` · `ContentStatus` · `VisibilityScope` · `StorageProvider` · `NotificationType` · `NotificationAudience`

### Modified existing models — additive only

```prisma
TechStack   + code? description? isActive position createdAt updatedAt
Batch       + learningPathId? code? startDate? endDate? status createdAt updatedAt
StudentBatch+ assignedAt          @@unique([studentId])   ← the one constraint
EnrollmentEventType + BATCH_ASSIGNED  BATCH_TRANSFERRED  BATCH_REMOVED
```

**`User`, `Session`, `Attendance`, `StudentProgress`, `InstructorBatch`, `EnrollmentEvent` — zero column changes.** Only Prisma back-relations, which emit no SQL.

### The one design addition beyond the approved architecture

Your instruction *"reuse equivalent completed activities"* on transfer required something v2 did not have. Cloning **deep-copies** content, so equivalent items get **different ids** — there was no way to recognise "React in MERN 2026" and "React in MERN 2027" as the same module.

**`originId` solves it.** A newly created module or content item is its own lineage root; clones carry the root forward unchanged. Two items are equivalent iff they share an `originId`. This is what powers the retained/new module counts in the transfer preview, and it is why the reuse rule is implementable at all.

---

## 3. API ENDPOINTS

### Added — 27 new endpoints under `/api/lms`

**Learning paths**
| Method | Route |
|---|---|
| GET / POST | `/lms/learning-paths` |
| GET / PATCH / DELETE | `/lms/learning-paths/:id` |
| POST | `/lms/learning-paths/:id/clone` |
| PATCH | `/lms/learning-paths/:id/status` |

**Modules**
| Method | Route |
|---|---|
| GET / POST | `/lms/learning-paths/:id/modules` |
| PATCH | `/lms/learning-paths/:id/modules/reorder` |
| PATCH / DELETE | `/lms/modules/:id` |
| PUT | `/lms/modules/:id/prerequisites` |

**Content**
| Method | Route |
|---|---|
| GET / POST | `/lms/modules/:id/contents` |
| PATCH | `/lms/modules/:id/contents/reorder` |
| PATCH / DELETE | `/lms/contents/:id` |
| PATCH | `/lms/contents/:id/status` |
| POST | `/lms/contents/:id/override` |
| POST | `/lms/contents/:id/{view,download,open,complete}` |

**Storage & student**
| Method | Route |
|---|---|
| POST | `/lms/uploads/sign` · `/lms/uploads/confirm` |
| GET | `/lms/me/curriculum` |

**Batch membership** (on the existing `/batches` router)
| Method | Route |
|---|---|
| POST | `/batches/:id/students/preview` — what a move would do |
| POST | `/batches/:id/students/assign` — assign or move one student |

### Modified — 1 endpoint

**`POST /batches/:id/students`** — still replaces a roster, still returns 200, but now **moves** students arriving from another batch instead of failing the unique constraint. Response gained a `data` object (`added`, `removed`, `moved`, `unchanged`); the `success` and `message` fields are unchanged.

---

## 4. FRONTEND

### New pages (3)

| Page | Route | Role |
|---|---|---|
| `CurriculumBuilder` | `/admin/curriculum` | ADMIN — authoring |
| `BatchCurriculum` | `/instructor/curriculum` | INSTRUCTOR — **read-only** |
| `MyCourse` | `/student/course` | STUDENT |

### New components (7)

`SortableList` + `SortableItem` (dnd-kit, keyboard-accessible) · `ModuleCard` · `ModuleFormDialog` · `ContentRow` · `ContentFormDialog` · `LearningPathDialog` · `MoveStudentDialog`

### New service

`services/lms.ts` — typed client for all 27 endpoints plus `uploadFile()`, which performs the signed direct-to-Cloudinary upload with real progress via XHR.

### Modified (4)

`AppRoutes.tsx` (3 lazy routes) · `AppSidebar.tsx` (nav per role) · `UserTable.tsx` (Move to Batch action) · `UserManagementPage.tsx` (dialog wiring)

### New dependency

`@dnd-kit/{core,sortable,utilities,modifiers}` — approved in the v2 checklist. Chosen over the HTML5 drag API because it is **keyboard-accessible out of the box**: tab to the handle, space to lift, arrows to move. Curriculum ordering is admin-critical and should not require a mouse.

---

## 5. BACKWARD COMPATIBILITY REPORT

### Verified untouched

| Subsystem | Evidence |
|---|---|
| **Authentication** | No file changed. 177 tests green including the auth suite |
| **Enrollment & credentials** | No file changed. Credential tests green |
| **Attendance** | `Attendance` model and all 5 endpoints untouched |
| **Sessions & Google Meet** | `Session`, `GoogleService`, Calendar/Meet flow untouched |
| **Email** | `EmailService` and both mailers untouched. LMS does not send email in Phase 1 |
| **`StudentProgress`** | Untouched. `/api/progress`, `AdminProgress`, `InstructorProgress`, `ProgressSliderDialog` all behave exactly as before |
| **`Batch.techStackId`** | **Kept required.** `POST/PATCH /batches` and `BatchFormDialog` unaffected — verified by reading the call sites before designing around them |
| **`express.json({limit:'10kb'})`** | Unchanged. Signed direct uploads mean no file reaches the body parser |
| **Response shapes** | `/auth`, `/users`, `/sessions`, `/attendance`, `/progress`, `/techstacks`, `/batches` unchanged (fields added only) |

### Changed — 2 items

| # | Change | Approved? | Mitigation |
|---|---|---|---|
| 1 | `POST /batches/:id/students` moves rather than rejects | ✅ Decision 1 | UI relabelled "Move Student to Batch"; every change audited |
| 2 | `@@unique([studentId])` makes multi-batch impossible | ✅ Decision 1 | Pre-flight gate blocks the migration until data is clean |

### One thing the typechecker caught

Adding three `EnrollmentEventType` values broke `enrollment-history.service.ts`, whose `Record<EnrollmentEventType, …>` label map became incomplete. That is the type doing its job — labels were added for all three. Worth noting because it is exactly the class of breakage a looser type would have shipped silently.

---

## 6. TEST RESULTS

```
Test Files  11 passed (11)
Tests      177 passed (177)
```

**+11 new tests in Phase 1**, all on the pure, security-sensitive core:

| Suite | Tests | Covers |
|---|---|---|
| `visibility.service.test.ts` | 17 | Draft/archived hiding · scheduled release incl. the exact boundary instant · batch scoping · **override vs inherit-and-add** · admin bypass · the Prisma `where` builder |
| `ordering.service.test.ts` | 9 | Complete permutations · duplicates · foreign ids · **partial lists** (a stale client must not silently drop items) · dense positions |
| `cloudinary.provider.test.ts` | 11 | Signature algorithm · folder separation · collision-freedom · slugification · **the signature covering `public_id`**, which is what stops a client redirecting an upload |

### A test that was wrong, and how it was caught

My first Cloudinary test asserted a hard-coded digest I described as "from Cloudinary's documentation". It failed. Rather than adjust the constant to match my code — which would have proven nothing — I recomputed the hash three independent ways (`shasum`, Node `crypto`, and the implementation). All three agreed; **my recalled constant was simply wrong.**

The test was rewritten to verify the **algorithm** — params sorted, joined `k=v&k=v`, secret appended with no separator, SHA-1 — by recomputing it inline, plus a case that would catch the most likely slip (joining the secret with `&`). A hard-coded digest would only ever prove the implementation still matches itself.

### Not covered

`LearningPathService`, `ModuleService`, `ContentService` and `BatchMembershipService` have **no unit tests** — they are Prisma orchestration and need a test database or a client mock. This is the honest gap in Phase 1 and is the first item in §10.

---

## 7. ROLLBACK PLAN

### Applying (not yet done)

```bash
cd backend
npm run lms:preflight          # gate — exits 1 and writes a CSV if data is dirty
npx prisma migrate deploy
npx prisma generate
```

Recommended pipeline line:
```
npm run lms:preflight && npx prisma migrate deploy
```

### Post-apply verification

```sql
-- 1. No batch left without a curriculum.
SELECT COUNT(*) FROM "Batch" WHERE "learningPathId" IS NULL;   -- expect 0

-- 2. One legacy path per tech stack.
SELECT ts.name, COUNT(lp.id) FROM "TechStack" ts
LEFT JOIN "LearningPath" lp ON lp."techStackId" = ts.id
GROUP BY ts.name;                                              -- expect 1 each

-- 3. One batch per student.
SELECT "studentId" FROM "StudentBatch"
GROUP BY 1 HAVING COUNT(*) > 1;                                -- expect 0 rows

-- 4. Batch/path invariant holds.
SELECT b.name FROM "Batch" b JOIN "LearningPath" lp ON lp.id = b."learningPathId"
WHERE lp."techStackId" <> b."techStackId";                     -- expect 0 rows
```

Checks 1 and 4 are also run automatically by `npm run lms:preflight`.

### Rolling back

**M2 only** (keep the LMS, drop the one-batch rule):
```sql
DROP INDEX "StudentBatch_studentId_key";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260801000100_lms_single_batch';
```

**Everything** (full Phase 1 revert):
```sql
DROP INDEX IF EXISTS "StudentBatch_studentId_key";
DROP TABLE "ContentProgress", "Content", "ModulePrerequisite", "Module",
           "Notification", "MediaAsset", "LearningPath" CASCADE;
ALTER TABLE "Batch" DROP COLUMN "learningPathId", DROP COLUMN "code",
  DROP COLUMN "startDate", DROP COLUMN "endDate", DROP COLUMN "status",
  DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
ALTER TABLE "TechStack" DROP COLUMN "code", DROP COLUMN "description",
  DROP COLUMN "isActive", DROP COLUMN "position",
  DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
ALTER TABLE "StudentBatch" DROP COLUMN "assignedAt";
DROP TYPE "ContentType", "ContentStatus", "VisibilityScope", "ModuleDifficulty",
          "LearningPathStatus", "BatchStatus", "StorageProvider",
          "NotificationType", "NotificationAudience";
DELETE FROM "_prisma_migrations"
WHERE migration_name IN ('20260801000000_lms_foundation','20260801000100_lms_single_batch');
```
Then redeploy the previous build.

**Rollback is total.** The backfill only wrote rows in dropped tables and a dropped column; no pre-existing data is transformed. The three added `EnrollmentEventType` values cannot be dropped (a PostgreSQL limitation) but are inert if unused — the same situation as the already-deprecated `CREDENTIAL_RESEND_BLOCKED`.

---

## 8. WHAT WORKS (pending runtime verification)

- Admin creates `MERN 2026`, adds modules with duration/difficulty/prerequisites, drags to reorder
- Admin uploads a PDF straight to Cloudinary; it never touches the API server
- Admin schedules content for a future release; students cannot see it until then — **with no cron**
- Admin overrides one global item for one batch; every other batch still sees the original
- Admin clones `MERN 2026` → `MERN 2027`; running batches are undisturbed
- Instructor sees assigned batches only, with drafts visible and **no edit affordance**
- Student sees only published, released, own-batch content; every module open from day one
- Moving a student previews retained vs. new modules before committing, and preserves all history

---

## 9. HONEST LIMITATIONS

1. **Nothing has been run.** No migration applied, no HTTP request issued, no page rendered. Every behavioural claim is derived from source plus a clean typecheck/build/test run. The database has been unreachable for this entire engagement.
2. **No integration tests.** The four Prisma-backed services are uncovered (§6).
3. **Cloudinary is unverified end-to-end.** The signature algorithm is unit-tested against an independent recomputation, but no real upload has been performed — no credentials are configured.
4. **The `validate()` middleware weakness persists.** It still discards its parsed output, so Zod's unknown-key stripping is inert. LMS services mitigate it the same way the enrollment work did: explicit field picking, never spreading `req.body` into Prisma.
5. **`ContentProgress` is written but not yet read.** Counters accumulate from Phase 1 so that Phase 3 analytics have history to work with, but no UI surfaces them yet — deliberate, since progress display is Phase 3.
6. **Prerequisites are stored and displayed, never enforced** — exactly as decision 7 specified.

---

## 10. RISKS AND FOLLOW-UPS

| # | Item | Severity | Recommendation |
|---|---|---|---|
| R1 | **Pre-flight has never run against real data** | 🔴 High | Run `npm run lms:preflight` the moment the database is reachable — **before** anything else. It is read-only |
| R2 | **No integration tests for the 4 Prisma services** | 🟠 Med | Add before Phase 2; submissions will depend on this layer |
| R3 | **Cloudinary unverified end-to-end** | 🟠 Med | Configure credentials and upload one PDF before Phase 2 |
| R4 | **Clone is O(modules × content) in one transaction** | 🟡 Low | 30 s timeout set. Fine for ~100 items; revisit at ~1000 |
| R5 | **Orphaned assets accumulate** | 🟡 Low | `StorageService.findOrphans()` exists; no admin UI yet |
| R6 | **2 pre-existing `npm audit` highs in `react-router-dom`** | 🟡 Low | Predates this work; fixing needs a major bump. Flagging, not silently carrying |
| R7 | **`Batch.learningPathId` is nullable but semantically required** | 🟡 Low | Promote to `NOT NULL` in a later migration once all write paths are proven |

### Recommended before Phase 2

1. Run the pre-flight, then apply M1 + M2.
2. Configure Cloudinary and verify one real upload.
3. Walk the §8 list in a browser.
4. Add integration tests for the four services.

---

## APPROVAL REQUESTED

Phase 1 is code-complete and verified as far as it can be without a database.

**I will not begin Phase 2** (activities, quizzes, mini-projects, submissions, evaluation) until you confirm Phase 1 is applied, tested and approved.

Two things would materially de-risk Phase 2, and I would rather raise them now than discover them mid-build:

- **Integration tests for the Prisma services** — Phase 2's submission layer builds directly on them, and it is the layer where a bug costs student work.
- **A verified Cloudinary upload** — Phase 2 adds student file submissions, which are far less forgiving of a storage misconfiguration than admin uploads are.
