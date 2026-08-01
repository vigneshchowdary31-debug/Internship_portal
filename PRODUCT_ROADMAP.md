# PRODUCT ROADMAP

**Project:** Student Training Portal
**Date:** 31 July 2026
**Basis:** Derived exclusively from the existing codebase. Every item below either fixes something that is broken, completes something the code already half-implements, or unlocks something the current architecture blocks. Nothing here is speculative product invention.

**Companion documents:** [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) · [TECHNICAL_AUDIT.md](TECHNICAL_AUDIT.md) · [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md)

**Complexity key:** **S** = under a day · **M** = 1–4 days · **L** = 1–2 weeks · **XL** = 2 weeks+
Estimates assume one engineer already familiar with the stack. They are effort, not calendar time.

---

## HOW TO READ THIS

Phase 1 items are things that are **wrong today**. Phase 2 items are things the product **visibly promises and does not deliver**. Phase 3 items make the product good rather than merely correct. Phase 4 is genuine expansion.

Two items are marked ⏳ **time-sensitive**: they get strictly harder or impossible the longer they wait, and should be pulled forward regardless of their tier.

---

# PHASE 1 — CRITICAL

*Everything here is a defect, a data-integrity risk, or a security hole. Target: 2–3 weeks.*

### 1.1 Restore Prisma migration history ⏳ **S** — do this first
**Why it matters.** `backend/prisma/migrations/` is git-ignored ([.gitignore:34](.gitignore#L34)) and the schema reaches the database via `prisma db push`. The production schema cannot be reproduced from the repository, no schema change is reviewable in a PR, there is no rollback path, and two developers can diverge with no conflict signal. Every other item in this roadmap that touches the schema is blocked behind this.
**How.** Remove the ignore rule, generate a baseline migration from the current schema (`migrate diff` against an empty datasource), mark it applied on production with `migrate resolve --applied`, and switch the Render build to `prisma migrate deploy`.
**Dependencies.** None. Requires a maintenance window and a verified production backup.
**Risk.** **Medium** — baselining against a live database must be done carefully; a wrong baseline can prompt Prisma to attempt destructive changes. Do it against a restored snapshot first.
**Impact.** Unblocks every future schema change safely. Without it, each subsequent DB item compounds the risk.

### 1.2 Fix the `validate()` middleware **S** — highest value-per-line in the repo
**Why.** [validate.middleware.ts:7-11](backend/src/middlewares/validate.middleware.ts#L7-L11) parses `{body, query, params}` into a throwaway and never assigns back to `req`. Zod's strip-unknown-keys behaviour therefore does **nothing**, across every validated endpoint. This is the root cause of the mass-assignment bug (1.4).
**How.** Assign the parsed result back: `const parsed = await schema.parseAsync(...); req.body = parsed.body ?? req.body;` (and the same for query/params where the schema declares them).
**Dependencies.** Must land together with 1.4 — see the warning there.
**Risk.** **Medium** despite being two lines. It will start silently dropping fields that endpoints currently rely on receiving. Audit every validated route for fields the handler reads but the schema omits before merging.
**Impact.** Restores input sanitisation globally.

### 1.3 Add resource-ownership authorization **M**
**Why.** Role gates exist; ownership checks do not. Any instructor can retime, cancel, or delete **any** session by ID — including firing cancellation emails at another instructor's cohort ([session.routes.ts:29-36](backend/src/routes/session.routes.ts#L29-L36)). This is the largest single deduction in the security score.
**How.** Add a small `authorize` helper alongside `restrictTo` — `ADMIN` passes everything; `INSTRUCTOR` must match `session.instructorId`. Apply to `PATCH /sessions/:id`, `/cancel`, `DELETE /sessions/:id`, `GET /attendance/session/:id`, and the attendance/progress mutations. Verify in `SessionService` too, so the rule is not routing-order-dependent.
**Dependencies.** None.
**Risk.** **Low** — additive. Confirm no existing admin workflow depends on the current permissiveness.
**Impact.** Closes the most serious authorization gap.

### 1.4 Close the mass-assignment hole on `PATCH /users/:id` **S**
**Why.** The controller forwards raw `req.body` into `prisma.user.update()` typed as `Prisma.UserUpdateInput` ([user.service.ts:74-94](backend/src/services/user.service.ts#L74-L94)). `{"password":"x"}` writes an **unhashed** password, permanently locking that account out because `bcrypt.compare` can never match.
**How.** Explicitly pick allowed fields in `UserService.updateUser` rather than spreading. Hash `password` if you choose to allow it.
**⚠️ Dependency trap.** The Edit User dialog sends `email`, which `updateUserSchema` does **not** permit — it only works today *because* of this hole ([UserFormDialog.tsx:71](frontend/src/components/users/UserFormDialog.tsx#L71)). Add `email` to the schema and the allowlist in the same change, or email editing breaks silently.
**Risk.** **Medium** purely because of that coupling.
**Impact.** Eliminates a data-corruption vector.

### 1.5 Scope student-record reads (IDOR) **S**
**Why.** `GET /attendance/student/:id` and `GET /progress/student/:id` are registered above the `restrictTo` gate ([attendance.routes.ts:18](backend/src/routes/attendance.routes.ts#L18), [progress.routes.ts:16](backend/src/routes/progress.routes.ts#L16)). Any student can read any other student's attendance and progress, including private instructor notes about them.
**How.** In the controller: a `STUDENT` may only request their own `id`; otherwise 403.
**Dependencies.** None. **Risk.** Low.
**Impact.** Closes a student-facing privacy breach.

### 1.6 Scope `GET /batches/:id` **S**
**Why.** Returns the full roster with every student's email address to any authenticated user, students included ([batch.routes.ts:35-53](backend/src/routes/batch.routes.ts#L35-L53)).
**How.** Admin → full; instructor → only their assigned batches; student → membership check, and omit peer emails.
**⚠️ Dependency.** `AttendanceFormDialog` calls this to build the roster — keep instructor access working.
**Risk.** Low. **Impact.** Closes PII exposure.

### 1.7 Fix `GET /auth/me` **S**
**Why.** [auth.middleware.ts:29-32](backend/src/middlewares/auth.middleware.ts#L29-L32) selects only `{id, role, status}`, and the controller returns it verbatim into a frontend type declaring `{id, name, email, role}`. After **any page refresh** the header renders `Hello, undefined` and the Profile page shows blank name and email fields.
**How.** Add `name` and `email` to the select.
**Dependencies.** None. **Risk.** Trivially low.
**Impact.** Fixes the most visible bug in the product. Also worth typing `req.user` properly instead of the global `any` — that `any` is precisely why this went unnoticed.

### 1.8 Remove hard coupling between Google and session creation **S**
**Why.** [session.service.ts:75-79](backend/src/services/session.service.ts#L75-L79) rethrows any Calendar failure as a 500 *before* the DB insert. A Google outage, an expired refresh token, or a >10 s response means **no class can be scheduled at all**. Contrast this with the email path, which is deliberately isolated — the asymmetry looks unintentional.
**How.** Persist the session with `googleMeetLink = null` and surface a warning, mirroring the email pattern. Add a "retry Meet link" action later (see 2.6).
**Dependencies.** UI must handle a null link — it already does (`SessionViewDialog` renders "No meeting link generated").
**Risk.** **Low technically, but it is a product decision** — confirm the business would rather have a session without a link than no session. Given the emails still send and the link can be regenerated, it is almost certainly correct.
**Impact.** Removes a third-party single point of failure from the core write path.

### 1.9 Wire up the test runner and cover the service layer **M**
**Why.** `npm test` is literally `echo "Error: no test specified" && exit 1`, so the two existing vitest specs **never run**. Business logic coverage is 0 %: no test exists for `SessionService`, `AttendanceService`, `ProgressService`, `UserService`, or `AuthService`. Every change in this roadmap is currently unverifiable.
**How.** Point `npm test` at vitest, add a config, and write service-layer tests with a mocked Prisma client and stubbed `GoogleService`/`EmailService`. Prioritise `AuthService.login`, `UserService.updateUser`, `SessionService.createSession`, and the two upsert services.
**⚠️ Dependency.** The static-class + direct-import design ([TECHNICAL_AUDIT §12.1](TECHNICAL_AUDIT.md)) makes mocking awkward — you will need module-level mocks rather than injection. Worth accepting for now rather than refactoring first.
**Risk.** Low. **Impact.** Turns every subsequent phase from "hope" into "verified".

### 1.10 Add structured logging **M**
**Why.** 168 raw `console.*` calls, no levels, no request IDs, no JSON. Correlating a user report to a log line means grepping Render's console by timestamp.
**How.** Adopt `pino`, add a request-ID middleware, replace `morgan`, and convert the noisiest paths first. Keep the email diagnostics output as-is — it is deliberately human-readable and genuinely good.
**Risk.** Low. **Impact.** Prerequisite for diagnosing anything in production.

### 1.11 Repository hygiene **S**
Untrack `backend/dist/` (36 stale files predating the `services/email/` refactor); delete or move the six scratch scripts at the backend root — **`verify-attendance.ts` and `verify-session-actions.ts` write to the live database and create real Calendar events**; change the seed's default admin credentials or gate the seed on non-production; delete the stale Railway configs (`railway.toml` healthchecks the authenticated `/api/users` and would always fail).
**Risk.** Low. **Impact.** Removes a foot-gun and roughly a third of the repo's confusion surface.

---

# PHASE 2 — HIGH PRIORITY

*Completing what the product already implies. Target: 3–5 weeks.*

### 2.1 Pagination, filtering, and server-side search **M**
**Why.** No list endpoint has `take`/`skip`. `GET /attendance/overview` returns **every attendance row ever written**, each with its session, batch, and student, and the browser computes four counters from it. The hard wall is around **1,000–2,000 attendance records** — a single 30-student cohort reaches that in ~50 sessions. Search is a client-side `.filter()` over the full downloaded list.
**How.** Add `page`/`limit`/`sort` to `/users`, `/sessions`, `/attendance/overview`, `/progress/overview`; add `dateFrom`/`dateTo`/`batchId`/`status` filters; move counters into a dedicated stats endpoint using Prisma `groupBy`. Add the missing indexes: `User.role`, `Session.startTime`, `Session(status, startTime)`, `Attendance.status`.
**Dependencies.** 1.1 (migrations) for the indexes.
**Risk.** **Medium** — every consuming page's response shape changes at once.
**Impact.** Removes the scaling wall and cuts the largest payloads by ~95 %.

### 2.2 Introduce a background job runner **M** — unlocks 2.3, 2.4, 3.5
**Why.** There is **no scheduler of any kind** — no cron, no queue, no worker, no `setInterval`. This single absence blocks session auto-completion, reminders, email retry, and calendar reconciliation: four separate roadmap items behind one piece of infrastructure.
**How.** Simplest viable option first: `node-cron` in-process on a paid Render instance, or an external scheduler hitting a token-protected `/api/jobs/:name` endpoint.
**⚠️ Infrastructure dependency.** **Render free instances sleep after inactivity, so an in-process scheduler will not fire reliably.** This is a hosting decision, not just a code one — decide it before building 2.3/2.4.
**Risk.** Medium. **Impact.** Unblocks the highest-value features in this phase.

### 2.3 Session auto-completion **S** (after 2.2)
**Why.** `SessionStatus.COMPLETED` exists in the enum, in `updateSessionSchema`, and renders as a green badge in two frontend components — but **no code path ever writes it**. Sessions stay `SCHEDULED` forever, which makes every historical report meaningless and leaves visibly dead UI.
**How.** Hourly job: `updateMany` where `status = SCHEDULED AND endTime < now()` → `COMPLETED`. Add `completedAt`.
**Dependencies.** 2.2, 1.1. **Risk.** Low.
**Impact.** Makes an existing, already-rendered feature actually work.

### 2.4 Class reminder emails **M** (after 2.2)
**Why.** This is **the highest-value use of infrastructure that already exists**. The email subsystem is production-grade — dual transport, circuit breaker, failure classification — and sits idle between session lifecycle events. Reminders are the single most requested feature in any scheduling product.
**How.** Job scans for sessions starting in the next 24 h / 15 min, sends via the existing `EmailService`, records `reminderSentAt` for idempotency.
**Dependencies.** 2.2, plus a new column (1.1).
**Risk.** **Medium** — the reliability risk is real: with no retry (2.5), a missed reminder is silently lost. Consider sequencing 2.5 first.
**Impact.** High perceived value for very little new code.

### 2.5 Email outbox with retry **M**
**Why.** Currently **one attempt per message, no persistence, no dead-letter**. A failed notification exists only as a log line and is permanently lost. This is the largest gap in an otherwise excellent subsystem.
**How.** Add an `EmailOutbox` table (recipients, subject, body, status, attempts, lastError). `EmailService.dispatch` writes a row, attempts delivery, updates status. A job retries `FAILED` rows with exponential backoff and a cap.
**Dependencies.** 2.2, 1.1. **Risk.** Low — purely additive.
**Impact.** Turns best-effort notification into reliable notification, and gives operators a queryable delivery record for the first time.

### 2.6 Google Calendar reconciliation **M**
**Why.** `updateSession` logs and swallows Calendar patch failures ([session.service.ts:193-196](backend/src/services/session.service.ts#L193-L196)); `deleteMeetEvent` returns `false` and the caller ignores it. Nothing detects the resulting DB↔Google divergence and nothing repairs it — orphaned calendar events accumulate invisibly.
**How.** Track a `calendarSyncStatus` per session; a job re-attempts divergent records; expose an admin "re-sync" action. Pairs naturally with the "retry Meet link" action from 1.8. Add `@@index([googleEventId])`.
**Dependencies.** 2.2, 1.1, 1.8. **Risk.** Medium — retry logic against a third party needs careful idempotency.
**Impact.** Makes the Google integration self-healing.

### 2.7 Fix email recipient privacy and timezones **S**
**Why.** Two concrete defects in the otherwise strong email layer: **every recipient is on one `To:` header** ([SmtpMailer.ts:223](backend/src/services/email/SmtpMailer.ts#L223)), so every student sees every classmate's email address; and dates are formatted with `Intl.DateTimeFormat('en-US')` in the **server's** timezone ([email.service.ts:77-82](backend/src/services/email.service.ts#L77-L82)) — on Render that is UTC, so an IST recipient sees a UTC time with no label.
**How.** Send per-recipient (or use BCC); include an explicit timezone in the formatted string; add a `timezone` column on `User` later for true per-user formatting.
**Risk.** Low. **Impact.** Fixes a privacy leak and a genuine source of missed classes.

### 2.8 Instructor session management UI **S**
**Why.** The API already fully supports instructors editing and cancelling sessions — **no screen calls it**. Instructors must currently ask an admin to move their own class.
**How.** Reuse `SessionTable` + `SessionFormDialog` on a new `/instructor/sessions` route.
**Dependencies.** **1.3 must land first**, or this hands every instructor a UI for editing everyone else's sessions.
**Risk.** Low. **Impact.** Removes a pointless admin bottleneck; near-zero new code.

### 2.9 Password reset and welcome emails **M**
**Why.** Accounts are admin-provisioned with a temporary password the admin types by hand and communicates out-of-band. There is **no forgot-password flow at all** — a locked-out user requires admin intervention and a manual password write (which currently corrupts the account, see 1.4).
**How.** `PasswordResetToken` table, request/confirm endpoints, rate-limited, single-use, expiring. Welcome email on user creation. Reuse the existing `EmailService`.
**Dependencies.** 1.1, ideally 2.5. **Risk.** Medium — auth-adjacent; get token expiry and single-use semantics right.
**Impact.** Removes the single biggest support burden the product will generate.

### 2.10 Toasts, error boundary, and honest UI feedback **S**
**Why.** Feedback is currently `alert()` (AdminDashboard), an inline red div (5 pages), or **nothing at all** — every mutation on the two user-management pages and every attendance/progress save fails silently. There is no React error boundary despite [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) claiming one, so any render throw blanks the app.
**How.** Add a toast provider, wire every mutation's `onError`/`onSuccess`, add a top-level error boundary, delete the `alert()` calls.
**Risk.** Low. **Impact.** Users stop losing work without knowing it.

### 2.11 Consolidate duplicate implementations **S**
**Why.** Two live session-creation dialogs with different validation ([AdminDashboard.tsx:107-151](frontend/src/pages/AdminDashboard.tsx#L107-L151) vs [SessionFormDialog.tsx](frontend/src/components/sessions/SessionFormDialog.tsx)); `StudentsManagement.tsx` and `InstructorsManagement.tsx` are ~95 % identical.
**How.** Delete the inline dialog and reuse `SessionFormDialog`; extract a `UserManagementPage` parameterised by role.
**Risk.** Low. **Impact.** Removes divergent validation behaviour users can actually hit.

### 2.12 Session scheduling guardrails **S**
**Why.** [session.validator.ts:9-11](backend/src/validators/session.validator.ts#L9-L11) only checks that `startTime` parses. Sessions can be scheduled **in the past**, and an instructor can be double-booked into overlapping sessions with no warning.
**How.** Reject past `startTime`; query for overlapping sessions for the same instructor and return a 409 (or a soft warning). Wire the unused `updateSessionSchema` into `PATCH /sessions/:id`, which currently runs **completely unvalidated**.
**Risk.** Low. **Impact.** Prevents a whole class of scheduling mistakes.

### 2.13 Fix the `Session.instructorId` cascade **S** ⏳ latent
**Why.** `onDelete: Cascade` on `Session.instructorId` ([schema.prisma:98](backend/prisma/schema.prisma#L98)) means deleting an instructor destroys every session they ever taught, which in turn cascades to **every attendance record for those sessions**. There is no user-delete endpoint today, so this is latent — but it becomes live data loss the moment one is added.
**How.** Change to `Restrict`. Reconsider `Session.batchId` on the same grounds.
**Dependencies.** 1.1. **Risk.** Low now; severe if deferred past a delete-user feature.

---

# PHASE 3 — NICE TO HAVE

*Makes the product good rather than merely correct. Target: 4–6 weeks.*

### 3.1 Progress history table **S** ⏳ **time-sensitive — pull forward**
**Why.** `StudentProgress` is a **snapshot, not a history** — every update overwrites ([progress.service.ts:13-33](backend/src/services/progress.service.ts#L13-L33)). "How did this student progress over the term?" is arguably the most valuable question a training portal can answer, and the data to answer it is **being destroyed every single day**. Adding the table later is easy; recovering the overwritten history is impossible.
**How.** Append-only `ProgressHistory` row on every upsert. Chart it on the student dashboard.
**Dependencies.** 1.1. **Risk.** Low. **Impact.** Low effort, permanently lost if delayed.

### 3.2 Calendar view **M**
**Why.** `/admin/calendar` is a live sidebar link that renders a `PlaceholderPage`, and `components/ui/calendar.tsx` is already installed and unused. Users click it and hit a dead end.
**How.** Month/week grid over `GET /sessions`, colour-coded by status, click-through to detail.
**Dependencies.** 2.1 (needs date-range filtering to avoid loading every session ever).
**Risk.** Low. **Impact.** Removes visible incompleteness; genuinely useful for spotting scheduling density.

### 3.3 Reports and CSV export **M**
**Why.** `AdminAttendance` and `AdminProgress` are already report-shaped — stat tiles plus a detail table — but read-only. Administrators will otherwise copy-paste from the browser.
**How.** Server-side CSV generation with the same filters as 2.1; per-batch and per-student attendance summaries.
**Dependencies.** 2.1. **Risk.** Low.

### 3.4 Audit log **M**
**Why.** There is **no record of who changed what, anywhere**. `Attendance.markedBy` is written but never read and has no FK — the intent existed and was never completed.
**How.** `AuditLog` table (actor, action, entity, entityId, before/after, timestamp); write from services for privileged actions; admin viewer. Make `markedBy` a real relation while you are there.
**Dependencies.** 1.1, 1.10. **Risk.** Low.
**Impact.** Prerequisite for any compliance conversation and for diagnosing "who cancelled my class".

### 3.5 Dashboard analytics **M**
**Why.** `AdminDashboard` currently shows four raw counts fetched by downloading every user, batch, and session. `AdminProgress` already computes an "At Risk (<50 %)" figure, which shows the appetite exists.
**How.** Dedicated aggregate endpoints using Prisma `groupBy`; attendance-rate trend, at-risk students, sessions-per-week, instructor load.
**Dependencies.** 2.1, 2.3 (trends are meaningless while nothing is ever `COMPLETED`).
**Risk.** Low.

### 3.6 Batch lifecycle **M**
**Why.** `Batch` has only `name` and `techStackId` — no dates, no status, no capacity, no timestamps. Every batch appears in every dropdown forever, including cohorts that graduated last year.
**How.** Add `startDate`, `endDate`, `status`, `capacity`, timestamps. Filter dropdowns to active batches. Make `@@unique([name, techStackId])`.
**Dependencies.** 1.1. **Risk.** Low — but touches every batch selector in the UI.

### 3.7 Refresh tokens and session hardening **M**
**Why.** No refresh token, so users are hard-logged-out at 24 h. `logout` is a client-side `localStorage` delete, so a stolen token stays valid until expiry. `role` is trusted from the JWT payload, so a demotion takes up to 24 h to take effect even though the user row is re-read on every request.
**How.** Short-lived access token + rotating refresh token in an `httpOnly` cookie; add `jti` for per-token revocation; read `role` from the DB rather than the payload (the query already happens).
**Risk.** **Medium** — auth changes are high blast-radius and touch every client request. Sequence after 1.9 gives you tests.
**Impact.** Closes the remaining Medium auth findings.

### 3.8 Attendance and progress UX completion **M**
Bulk attendance endpoint (replacing N parallel POSTs from `AttendanceFormDialog`, which currently leaves partial state on partial failure); attendance history detail for students; enrolment validation before marking; instructor-scoped progress endpoint so instructors stop downloading the entire organisation's progress data.
**Dependencies.** 1.3, 2.1. **Risk.** Low.

### 3.9 API documentation **S**
OpenAPI spec generated from the Zod schemas (`zod-to-openapi`), served at `/api/docs`. **Risk.** Low.

### 3.10 CI pipeline **S**
GitHub Actions: typecheck, lint, test, build on every PR. Dependabot. Blocked on 1.9 being meaningful. **Risk.** Low. **Impact.** Prevents regression of everything in Phase 1.

### 3.11 Frontend polish **M**
Skeleton loaders (`ui/skeleton.tsx` is installed and used only internally); debounced search; `staleTime` and consistent query keys (`['sessions']` vs `['sessions', user.id]` currently fragment the cache for the same endpoint); accessibility pass on hand-rolled controls — the `AdminDashboard` native `<select>`s lack label association, progress bars have no `role="progressbar"`, attendance radio groups have no `<fieldset>`/`<legend>`, and several tables convey status by colour alone.
**Risk.** Low.

### 3.12 Delete unused code **S**
Two empty directories, one unused validator, three write-only DB columns, four unused UI primitives, an unused 184-line `App.css`, three unused image assets, and a fully-configured dark mode with **zero `dark:` classes**. Either implement dark mode or remove the configuration — leaving it half-present misleads the next developer.
**Risk.** Low.

---

# PHASE 4 — FUTURE ENHANCEMENTS

*Genuine expansion. Only after Phases 1–2 are complete.*

| Feature | Complexity | Why it matters | Dependencies | Risk |
|---|---|---|---|---|
| **Recurring sessions** | **L** | The most-requested scheduling feature anywhere. A weekly class currently requires manual creation every week | 2.12; RRULE handling; **named-timezone Calendar events** — the current UTC-offset-only payload would drift across DST | **High** — recurrence + timezones + Google sync is the classic source of subtle bugs |
| **Per-instructor Google identity (option 8b)** | **L** | The **only** path to real Meet host powers on free Google services — instructor joins first, admits knockers, holds host controls. Fully analysed in [docs/google-meet-cohost-feasibility.md §8b](docs/google-meet-cohost-feasibility.md) | Per-instructor refresh-token storage + consent flow; **relaxes the "one shared account" constraint** — a product decision, not an engineering one | **High** — unverified OAuth consent screens expire external refresh tokens in 7 days; the app must be verified or instructors added as test users. The doc is explicit that free-account host powers were not empirically confirmed — **test with two accounts before promising instructors anything** |
| **Notification centre** | **M** | In-app notifications alongside email; per-user preferences | 2.5 | Low |
| **File / resource sharing** | **L** | Attach materials to sessions or batches | Object storage (S3/Supabase Storage), upload validation, virus scanning | Medium |
| **Assignments & submissions** | **XL** | Turns a scheduling tool into an LMS | File storage, grading model, new roles | **High** — a genuinely different product; validate demand first |
| **Certificates** | **M** | Auto-issue on batch completion | 3.6 (batch lifecycle), PDF generation | Low |
| **Session feedback & ratings** | **M** | Post-session survey, instructor quality signal | 2.3 (needs `COMPLETED` to trigger) | Low |
| **Student self-service enrolment** | **M** | Browse and request batches | 3.6, approval workflow | Medium |
| **Multi-tenancy** | **XL** | Multiple organisations on one deployment | Tenant column on every table, row-level scoping, migration of existing data | **Very high** — retrofitting tenancy is one of the hardest changes to make to a mature schema. Decide **before** the data grows |
| **Mobile app / PWA** | **L** | Push notifications for class start | Stable API contract, 3.9 | Medium |
| **Real-time updates** | **M** | Live attendance, presence | WebSocket layer, sticky sessions | Medium |
| **Meet recording management** | — | **Do not build** | — | **Blocked upstream.** [docs/google-meet-cohost-feasibility.md](docs/google-meet-cohost-feasibility.md) proves recording requires a paid tier **and** has no public start/stop API at any tier |

---

## SEQUENCING

```
Weeks 1-3   PHASE 1  ── 1.1 migrations FIRST (blocks all schema work)
                        1.2+1.4 together (coupled — see the trap)
                        1.3 → 1.5 → 1.6 → 1.7 → 1.8
                        1.9 tests → 1.10 logging → 1.11 hygiene
                        ⏳ pull 3.1 (progress history) forward — data is
                           being destroyed every day it waits

Weeks 4-8   PHASE 2  ── 2.1 pagination ── decide hosting ──► 2.2 scheduler
                                                              ├─ 2.3 auto-complete
                                                              ├─ 2.5 outbox ─► 2.4 reminders
                                                              └─ 2.6 reconciliation
                        parallel track: 2.7 → 2.8 (needs 1.3) → 2.9
                                        2.10 → 2.11 → 2.12 → 2.13

Weeks 9-14  PHASE 3  ── 3.2 calendar · 3.3 export · 3.4 audit · 3.5 analytics
                        3.6 batch lifecycle · 3.7 refresh tokens · 3.8 UX
                        3.9 docs · 3.10 CI · 3.11 polish · 3.12 cleanup

Later       PHASE 4  ── validate demand before committing to any XL item
```

---

## DECISIONS NEEDED FROM THE BUSINESS

These block engineering work and cannot be resolved from the codebase:

1. **Render plan.** Free instances sleep and block outbound SMTP. A paid instance is required for a reliable in-process scheduler — which gates reminders, auto-completion, and email retry (2.2 → 2.3/2.4/2.5). Alternative: an external cron. Decide before starting 2.2.
2. **The shared-Google-account constraint.** Relaxing it enables option 8b and real instructor host controls. Keeping it caps the Meet experience permanently at "everyone joins directly, nobody moderates".
3. **Session creation without a Meet link (1.8).** Confirm the business prefers a link-less session over a failed scheduling attempt.
4. **Multi-tenancy.** Only relevant if this will ever serve more than one organisation. **Deciding late is enormously more expensive than deciding early** — retrofitting tenant scoping onto a populated schema is the hardest change on this list.
5. **Data retention.** Nothing is ever deleted or archived. `/attendance/overview` grows without bound and will be the first thing to break.
