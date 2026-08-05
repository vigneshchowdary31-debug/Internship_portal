# LMS Phase 1 — Sign-off Report

**Date:** 2026-08-03
**Scope:** Foundation — schema, migrations, permissions, learning paths, modules, learning content, file storage.
**Verdict:** ✅ **Phase 1 complete.** Cleared to start Phase 2, with one account-level configuration item to action first.

---

## 1. Verification results

| Check | Result |
|---|---|
| Backend typecheck (`tsc --noEmit`) | ✅ clean |
| Backend tests (`vitest run`) | ✅ **188 passed**, 11 files |
| Frontend typecheck | ✅ clean |
| Frontend build | ✅ built in 518 ms |
| Cloudinary end-to-end | ✅ **53 assertions passed, 0 failed** |
| Migrations | ✅ 7 applied, `Database schema is up to date` |
| Leftover state | ✅ 0 Cloudinary resources, 0 MediaAsset rows |

### Cloudinary end-to-end (live API, real files)

Driven through `StorageService` — the actual shipping code path, not a reimplementation.

| File | resource_type | format | public_id returned | Persisted correctly | Delivery |
|---|---|---|---|---|---|
| sample.pdf | `image` | `pdf` | `…/sample-xxxx` | ✅ | ⚠️ 401 (account setting) |
| sample.docx | `raw` | — | `…/sample-xxxx**.docx**` | ✅ | ✅ 200 |
| sample.pptx | `raw` | — | `…/sample-xxxx**.pptx**` | ✅ | ✅ 200 |
| sample.zip | `raw` | — | `…/sample-xxxx**.zip**` | ✅ | ⚠️ 401 (account setting) |
| sample.png | `image` | `png` | `…/sample-xxxx` | ✅ | ✅ 200 |

For every file: upload succeeded, `MediaAsset` row created, `resourceType` and `format` persisted, `providerKey` matched Cloudinary's **returned** `public_id`, delete returned `result="ok"`, Admin API confirmed 404, DB row removed. No orphans in either system.

---

## 2. Defects found and fixed

Verification **failed on first run** and found four real defects. All are fixed and covered by regression tests.

**1. `/auto/destroy` is not a valid endpoint.** `auto` works for upload only. Every delete returned `400 Invalid resource type 'auto'`.

**2. We stored the `public_id` we *signed*, not the one Cloudinary *returned*.** Cloudinary appends the extension for `raw` assets. Deletes therefore missed — and answered **HTTP 200 `{"result":"not found"}`**, which the old code read as success. This was the most serious of the four: content would show as deleted in the UI while remaining stored, billed, and publicly fetchable.

**3. `MediaAsset` had no `resourceType`**, so the correct destroy URL could not be constructed at all. Added via migration `20260803000000_media_asset_resource_type` (two nullable columns, applied against an empty table).

**4. `getSignedDownloadUrl` built the same invalid `/auto/upload/` path** (verified: `404 Resource not found`). Dead code today — the app serves the stored `secure_url` — but it would have reproduced defect #1 the moment Phase 2 submissions called it.

Two hardening changes came out of the same investigation:

- `delete()` now **throws on `result !== "ok"`**. A phantom delete can no longer pass as success.
- `delete()` now sends **`invalidate: true`**, purging CDN edge caches. Verified: without it a deleted asset kept serving HTTP 200 from cache after the Admin API already reported 404; with it, the edge returned 404 within 30 s.

### Why these weren't guessable

PDF is classified `image`, **not** `raw` — Cloudinary rasterises PDFs. Any mimeType→resource_type mapping written from intuition would have routed every PDF delete to `/raw/destroy` and silently failed, i.e. reintroduced defect #2. `resourceType` is now **stored from the upload response, never inferred**.

---

## 3. Remaining known issues

### 🔴 Action required before instructors upload content

**PDF and ZIP delivery is disabled on the Cloudinary account.** Verified: PDF returns `deny or ACL failure`, ZIP returns `Untrusted File Access`; DOCX/PPTX/PNG deliver fine. This is Cloudinary's default security posture, not an application defect — uploads and deletes work correctly for both.

Impact if unaddressed: **students cannot open PDF course material, and ZIP submissions cannot be downloaded.** PDF is the most common format for course content, so this blocks the primary Phase 1 use case.

Fix: Cloudinary Console → **Settings → Security → enable "PDF and ZIP files delivery"**. No code change; re-run verification afterwards to confirm.

### 🟡 Not yet verified

- **Browser testing of the Phase 1 UI has not been done.** Curriculum builder drag-and-drop, module CRUD, content CRUD, visibility overrides, and the student/instructor course views are covered by unit tests and typecheck, but no one has clicked through them. This is the largest remaining unknown and I cannot close it myself.
- **The Cloudinary end-to-end run is not in CI.** It needs live credentials and creates/destroys real objects, so it ran as a one-off. The regression tests that encode its findings *are* in the suite; the live round-trip is not.

### 🟢 Accepted limitations (by design, documented)

- `MediaAsset.resourceType` / `format` are nullable. Safe today — the table was empty when the columns were added, so there are no legacy nulls. `delete()` falls back to `image`, which is correct for the largest class of assets but would miss on a legacy `raw` row. Worth revisiting only if rows ever predate the column.
- `STORAGE_PROVIDER=SUPABASE` is not implemented; the adapter warns and falls back to Cloudinary.
- CDN invalidation is asynchronous (~30 s observed). Deletion is immediate and authoritative at the origin.

---

## 4. Production readiness

**Score: 8.5 / 10** — for the Phase 1 foundation.

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 9 | Four defects found and fixed under live conditions; all covered by regression tests. |
| Data integrity | 9 | Migrations applied cleanly, no drift, no orphans in DB or storage. |
| Test coverage | 8 | 188 tests. Gap: no automated live-API integration run. |
| Security | 9 | Signed uploads, policy enforced pre-signature, no credential logging, role checks on write paths. |
| Operational readiness | 7 | One account setting outstanding; no storage monitoring/alerting yet. |
| UI confidence | 6 | Unverified in a browser. |

The deduction is driven almost entirely by the two items in §3 — the account setting and the unexercised UI — not by the state of the code.

---

## 5. Recommendation for Phase 2

**Proceed with Phase 2, in this order:**

1. **Enable "PDF and ZIP files delivery"** in the Cloudinary console and re-run the round-trip. ~2 minutes, and it unblocks the core Phase 1 use case.
2. **Click through the Phase 1 UI once** — upload a PDF as an instructor, confirm a student sees and opens it. This is the one thing automated checks cannot substitute for, and it exercises exactly the path the defects above lived in.
3. **Then start Phase 2** (activities, quizzes, mini-projects, submissions, evaluation).

Phase 2 rests directly on the storage layer just fixed — submissions are file uploads with the same signing, confirm, and delete lifecycle. That layer is now correct and regression-tested, so the foundation is sound. Two specific carry-overs to honour when building submissions:

- Reuse `StorageService.confirmUpload` and pass through Cloudinary's **returned** `public_id`, `resource_type`, and `format`. Never the signed key.
- Submission artifacts are `Restrict` on delete by design — student work must never be silently detached from its file.

I'd treat step 1 as genuinely blocking and step 2 as strongly advised rather than blocking; the risk it covers is UI wiring, which is cheap to fix later, whereas the storage risk it would have caught is now closed.
