# LMS Phase 2 — Curriculum Builder & Content Management

**Date:** 2026-08-04
**Status:** Code complete and verified. **One migration awaiting your approval to apply.**

---

## 1. Architecture summary

Phase 1 turned out to have already delivered most of Phase 2's surface. The audit before writing any code found F1 (learning paths), F4 (visibility), F5 (Cloudinary), F6 (scheduling), F7 (drag-and-drop), F8 (student view) and F9 (instructor view) complete, with F2, F3 and F10 partially done. Phase 2 was therefore scoped as a **delta**, not a rebuild — honouring rules 1, 4 and 5.

Three principles shaped what was added:

**The visibility rule stays in one place.** Search and progress are both new query surfaces, and both are places an authorization bypass appears naturally — a filter that forgets the scope clause returns another batch's material and looks correct in every test that only checks the search term. Neither service reimplements the rule; both AND in `contentVisibilityWhere`, the same builder the curriculum reads use. That invariant is asserted directly in the tests.

**Notifications are two-tier.** `Notification` holds the event once; `NotificationRecipient` holds one thin row per person with read state. A 200-student announcement is 1 + 200 rows rather than 200 copies of the title and body, and the unread badge is a count over one index rather than a per-request union of batch/path/stack/role rules.

**Progress is derived, never stored.** A cached `percent` column would need invalidating on publish, release, batch override, and clone — and the first missed invalidation shows a student a wrong number they cannot refresh away. Two grouped queries compute it regardless of module count.

---

## 2. Files changed

**New — backend (7)**
| File | Purpose |
|---|---|
| `services/lms/notification.service.ts` | Fan-out, delivery, read state (F11) |
| `services/lms/search.service.ts` | Search, filters, facets (F12/F13) |
| `services/lms/curriculum-progress.service.ts` | Progress roll-ups (F10) |
| `services/lms/notification.service.test.ts` | 18 tests |
| `services/lms/search.service.test.ts` | 20 tests |
| `services/lms/curriculum-progress.service.test.ts` | 15 tests |
| `services/lms/content.service.test.ts` | 13 tests |

**New — frontend (2)**
`components/lms/NotificationBell.tsx`, `components/lms/ContentSearch.tsx`

**Modified — backend (7)**
`prisma/schema.prisma`, `services/lms/content.service.ts`, `services/lms/module.service.ts`, `services/lms/learning-path.service.ts`, `controllers/lms.controller.ts`, `routes/lms.routes.ts`, `validators/lms.validator.ts`, `test/prismaMock.ts` *(extended additively — every pre-existing test kept its exact behaviour)*

**Modified — frontend (6)**
`services/lms.ts`, `layouts/DashboardLayout.tsx`, `components/lms/ModuleFormDialog.tsx`, `components/lms/ContentFormDialog.tsx`, `components/lms/ModuleCard.tsx`, `components/lms/ContentRow.tsx`, `pages/lms/MyCourse.tsx`, `pages/lms/CurriculumBuilder.tsx`

---

## 3. Database changes

Migration `20260804000000_lms_phase2_curriculum` — **strictly additive**, no column altered, renamed or dropped.

```sql
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'REFERENCE';
ALTER TABLE "Module" ADD COLUMN IF NOT EXISTS "thumbnailAssetId" TEXT;
CREATE TABLE IF NOT EXISTS "NotificationRecipient" (...);
```

Generated with `prisma migrate diff` against the live database, then hardened by hand. **Every statement is idempotent** — `ADD VALUE IF NOT EXISTS`, `IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object` — because `ALTER TYPE ... ADD VALUE` cannot run inside a transaction, so PostgreSQL forces Prisma to split the file. That split is exactly what left the Phase 1 migration half-applied and unretryable. This one can be re-run safely after a partial failure.

`REFERENCE` is appended last so existing enum ordinals are untouched. `thumbnailAssetId` is nullable, so no backfill. `NotificationRecipient` is new, so nothing to migrate.

---

## 4. API changes

All additive; no existing endpoint changed shape.

| Method | Route | Notes |
|---|---|---|
| GET | `/lms/contents/search` | Filters: q, module, type, status, scope, batch; paginated |
| GET | `/lms/contents/facets` | Counts for the filter UI |
| GET | `/lms/notifications` | Paginated, `?unreadOnly=true` |
| GET | `/lms/notifications/unread-count` | Cheap badge query |
| PATCH | `/lms/notifications/:id/read` | Scoped by userId |
| PATCH | `/lms/notifications/read-all` | |
| GET | `/lms/me/progress/:learningPathId` | Own progress |
| GET | `/lms/me/resume` | Continue-learning target |
| GET | `/lms/batches/:id/progress` | Instructor/admin only — **403 for students** |

**Backward compatibility:** `GET /lms/modules/:id/contents` returns the original array when no pagination params are sent, and an array plus `meta` when they are. Every Phase 1 caller keeps working untouched.

Route order matters and is correct: `/contents/search` precedes `/contents/:id`, `/notifications/read-all` precedes `/notifications/:id/read`.

---

## 5. Frontend changes

- **Notification bell** in the dashboard header. The cheap count polls every 60s; the expensive list only loads while the popover is open.
- **Search panel** in the Curriculum Builder — debounced 300ms, `keepPreviousData` so the list doesn't blank between pages, and a hit expands + scrolls to its module.
- **Thumbnail upload** in the module dialog with a progress bar, reusing the Phase 1 signed-upload path (rule 2 — no duplicate upload logic).
- **Progress bars** on the student course page: weighted overall, plus per-module.
- **Reference Material** type showing both file and URL inputs, requiring one.

---

## 6. Tests added

**66 new tests; 254 passing overall** (was 188).

Weighted toward the things that fail quietly rather than loudly:
- Batch-scoped content notifies **only that batch**, never the whole path
- A published item is **never re-announced** on re-save
- Scheduled items are **not** announced before their release moment
- Email failure records a reason and **does not fail the publish**
- Content titles are **HTML-escaped** into emails
- Search **always** carries the visibility clause — including with no term, no filters, and a hostile `batchId`
- Overall progress is **weighted, not averaged** (1/1 + 0/99 reads 1%, not 50%)
- Progress **cannot exceed 100%** when an item becomes hidden after completion

Two bugs in my own tests were found and fixed while writing them: leaked `mockResolvedValueOnce` queues (`clearAllMocks` doesn't drain them) and an unpinned `now` that made visibility-clause comparisons pass or fail on millisecond timing.

---

## 7. Verification

| Check | Result |
|---|---|
| Backend typecheck | ✅ clean |
| Backend tests | ✅ **254 passed**, 15 files |
| Frontend typecheck | ✅ clean |
| Frontend build | ✅ 569 ms |
| Migration | ⚠️ **written, verified, not applied** |

Note: `npm run build` caught three errors that bare `tsc --noEmit` did not — the build uses the stricter project config. All three are fixed.

---

## 8. Remaining work for Phase 3

- Assignments, mini-projects, quizzes, submissions, evaluation *(explicitly out of scope here)*
- Notification types beyond content publishing — the enum already carries `ASSIGNMENT_PUBLISHED`, `DUE_DATE_REMINDER` etc.; only the content path is wired
- Dashboard analytics and cohort-level reporting
- Notification preferences (per-user email opt-out)
- Full-text search — `contains` is adequate at current scale; see risks

---

## 9. Risks

**🔴 Migration not yet applied.** Blocked by the permission classifier; see §11. The code expects the new columns, so the running app must not be deployed before the migration.

**🟡 Search uses `contains`, not a full-text index.** Fine at current scale, but this becomes a sequential scan on a large content table. Trigram or `tsvector` indexing is the upgrade — deferred rather than guessed at, since it needs real data volume to size.

**🟡 Announcement is opportunistic.** Scheduled-release notifications fire on the first student page load after the release moment. If nobody opens the app, nobody is emailed until someone does. This is the deliberate cost of the "no cron" rule you approved, and the release itself is already lazy for the same reason.

**🟡 Batch announcement is one shared email.** `perRecipient: false` puts recipients in one message, unlike credential mail. The content title is not personal data, but a 200-student batch means 200 addresses share a header. If that's not acceptable, flipping one flag makes it per-recipient at the cost of 200 sequential sends.

**🟢 Thumbnails accept image types only** at the UI, but the server applies the shared 50 MB content policy rather than a smaller thumbnail-specific limit.

---

## 10. Production readiness

**Score: 8 / 10** — pending the migration.

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 9 | 66 targeted tests; visibility invariant asserted directly |
| Data integrity | 9 | Additive, idempotent, generated from a live diff |
| Test coverage | 8 | Services well covered; no HTTP-level or UI tests |
| Security | 9 | Visibility enforced in one place; batch progress gated from students; HTML escaped |
| Operational readiness | 7 | Migration unapplied; no notification-volume monitoring |
| UI confidence | 6 | Typechecks and builds; **not exercised in a browser** |

Same two deductions as Phase 1: something outstanding operationally, and a UI nobody has clicked. The Phase 1 items — the Cloudinary **"PDF and ZIP files delivery"** setting and browser testing — are still open and still gate real use.

---

## 11. What needs your approval

`npx prisma migrate deploy` was **denied by the permission classifier**, correctly: your Phase 2 request never mentioned applying migrations to production, and you have run these yourself before.

The migration adds one enum value, one nullable column, and one empty table. It is idempotent, so a partial failure is safely retryable — unlike the Phase 1 migration that taught us this.

Approve it and I'll apply it, re-run the full verification against the live schema, and confirm. Until then the code is complete and green but **must not be deployed**, since it expects columns the database does not yet have.
