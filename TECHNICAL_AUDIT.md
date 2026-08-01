# TECHNICAL AUDIT

**Project:** Student Training Portal
**Audit date:** 31 July 2026
**Scope:** Architecture, database, API, UI, authorization, integrations, error handling, security, performance, code quality.
**Companion documents:** [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) · [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) · [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md)

---

## 1. ARCHITECTURE

### 1.1 Shape

A conventional two-tier SPA + REST monolith. No message bus, no cache, no worker, no queue.

```
┌──────────────────────────┐         ┌───────────────────────────────────────┐
│ Vercel — React SPA       │  HTTPS  │ Render — Express monolith             │
│                          │ Bearer  │                                       │
│ AuthContext (localStorage│────────▶│ helmet → cors → rateLimit → morgan    │
│ TanStack Query cache     │   JWT   │ → compression → json(10kb) → router   │
│ axios interceptors       │         │                                       │
│ 17 lazy routes           │         │ routes → controllers → services       │
└──────────────────────────┘         │                    ↓                  │
                                     │              Prisma Client            │
                                     └───────┬───────────────┬───────────────┘
                                             │               │
                              ┌──────────────┴───┐   ┌───────┴────────────────┐
                              │ Supabase Postgres│   │ Google APIs            │
                              │ (pgBouncer pool) │   │ · Calendar v3 (Meet)   │
                              └──────────────────┘   │ · Gmail v1 (send)      │
                                                     └────────────────────────┘
                                                       ▲
                                                       │ fallback when SMTP blocked
                                     ┌─────────────────┴──────┐
                                     │ Gmail SMTP :587/:465   │
                                     └────────────────────────┘
```

### 1.2 Layering — and where it breaks

The intended pattern is `route → controller → service → Prisma`, with Zod validation as middleware and `asyncHandler` funnelling rejections into one error handler. Where it is followed (auth, users, sessions, attendance, progress) the code is clean and readable.

It is **not** followed in two places:

- [techstack.routes.ts](backend/src/routes/techstack.routes.ts) — full CRUD, Prisma calls, and error translation inline in the router. No service, no controller, no validator.
- [batch.routes.ts](backend/src/routes/batch.routes.ts) — same, plus the two `$transaction` assignment endpoints.

That is 187 lines of business logic living in the routing layer, using hand-rolled `if (!name) return res.status(400)` instead of the Zod middleware every other domain uses.

`src/repositories/` exists and is **empty** — a repository layer was planned and abandoned. Services talk to Prisma directly, which is a defensible choice for an app this size; the empty directory is just noise.

### 1.3 Service style

All seven services are **static classes with no state and no constructor** — effectively namespaced module functions. There is no dependency injection anywhere, so `SessionService` reaches out to `GoogleService` and `EmailService` by direct import. This is why the service layer cannot be unit-tested without live Google and SMTP credentials.

The one exception is `SmtpMailer`, which holds genuine module-level mutable state (the circuit breaker's `blockedUntil` / `blockedReason`) — appropriate, but note it is per-process, so a multi-instance deployment maintains independent breakers.

### 1.4 External integrations

| Integration | Purpose | Auth | Failure isolation |
|---|---|---|---|
| Google Calendar v3 | Create/patch/delete events, provision Meet links | Shared OAuth refresh token | ❌ **None on create** — failure aborts the request |
| Gmail API v1 | Send notifications over HTTPS/443 | Separate `gmail.send` refresh token | ✅ Fully isolated |
| Gmail SMTP | Primary email transport | App Password | ✅ Fully isolated + circuit breaker |
| Supabase Postgres | Persistence | Connection string | ⚠️ Fail-fast at boot only |

### 1.5 Architectural strengths

1. **Correct failure-isolation philosophy in email.** [email.service.ts](backend/src/services/email.service.ts) documents and enforces the rule that a mail failure can never reach the caller's request path. Every public method resolves, never rejects.
2. **Transport selection is not vendor abstraction.** The fallback triggers *only* on network-class failures ([email.service.ts:62-68](backend/src/services/email.service.ts#L62-L68)); auth/TLS/recipient errors deliberately surface rather than being masked by a second provider. That is a genuinely sophisticated decision.
3. **Fail-fast configuration.** [env.ts](backend/src/config/env.ts) exits on missing required vars but only *warns* on missing email vars — the split matches which failures are recoverable.
4. **Graceful degradation for local development.** No `GOOGLE_REFRESH_TOKEN` yields mock Meet links ([google.service.ts:78-87](backend/src/services/google.service.ts#L78-L87)) so the app runs fully offline.
5. **Route-level code splitting** on all 17 frontend pages.

### 1.6 Architectural weaknesses

1. **Google is a synchronous hard dependency of the core write path.** See §11.3.
2. **No background execution capability at all.** No cron, no queue, no worker. This single absence blocks reminders, session auto-completion, email retry, and cleanup — four separate roadmap items.
3. **No authorization layer.** Role checks are middleware; ownership checks do not exist. There is no policy object, no `can(user, action, resource)` helper, nowhere to put one.
4. **No migration history.** `backend/prisma/migrations/` is git-ignored ([.gitignore:34](.gitignore#L34)). The schema is applied with `db push`.
5. **Two divergent implementations of the same feature** (session creation UI) shipping simultaneously.
6. **Circuit breaker state is per-process** — correct for single-instance Render, silently degraded when scaled horizontally.

---

## 2. DATABASE AUDIT

**Provider:** PostgreSQL via Supabase. **ORM:** Prisma 7.9 with the `@prisma/adapter-pg` driver adapter over a `pg.Pool` ([db.ts](backend/src/config/db.ts)). **Schema:** [backend/prisma/schema.prisma](backend/prisma/schema.prisma), 153 lines, 8 models/enums.

### 2.0 The migration problem — read this first

```gitignore
# .gitignore line 34
backend/prisma/migrations/
```

There is **no migration directory on disk and none in git**. The schema reaches the database through `prisma db push` ([README.md](README.md) install steps). Consequences:

- The production schema cannot be reproduced from the repository.
- No schema change is reviewable in a pull request.
- There is no rollback path for a bad column change.
- `db push` on a table with data can silently require data loss to proceed.
- Two developers can diverge without any conflict signal.

Everything else in this section is secondary to fixing this.

### 2.1 `User`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Application-generated UUID |
| `name` | `String` | |
| `email` | `String @unique` | Login identifier. **No case normalisation** — `A@x.com` and `a@x.com` are distinct rows |
| `password` | `String` | bcrypt cost 10. Can be corrupted to plaintext via §5 mass assignment |
| `role` | `Role @default(STUDENT)` | |
| `status` | `Boolean @default(true)` | Active flag |
| `createdAt` / `updatedAt` | `DateTime` | |

**Relations:** `studentBatches`, `instructorBatches`, `sessions` (`InstructorSessions`), `attendances`, `progressRecords`.
**Indexes:** implicit unique on `email`, PK on `id`. **No index on `role`**, despite `GET /users?role=X` being the most-called list query.

**Missing columns:** `lastLoginAt`, `emailVerified`, `phone`, `avatarUrl`, `passwordChangedAt`, `deletedAt`, `timezone`.

**Improvements:**
- Add `@@index([role])` and `@@index([status, role])`.
- Normalise email to lower-case on write, or add a functional unique index.
- Replace `status: Boolean` with a `UserStatus` enum (`ACTIVE|SUSPENDED|ARCHIVED`) — a boolean cannot express "invited but never logged in", which the current admin-provisioning flow actually needs.
- `password` should never be selectable by default; consider Prisma client extensions or a `omit` default.

### 2.2 `TechStack`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `name` | `String @unique` | Case-sensitive: "React" and "react" can coexist |

**Relations:** `batches`, `progressRecords`.
**Missing:** `description`, `createdAt`, `updatedAt`, `isActive`, `sortOrder`. This is the only model in the schema with **no timestamps at all**.
**Note:** delete is FK-protected in application code ([techstack.routes.ts:45-52](backend/src/routes/techstack.routes.ts#L45-L52)) but the `Batch → TechStack` relation has **no `onDelete` rule**, so it defaults to `Restrict` — the DB enforces it too. Correct by accident, but worth making explicit.

### 2.3 `Batch`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `name` | `String` | **Not unique** — duplicate batch names are permitted |
| `techStackId` | `String` | FK → `TechStack`, indexed |

**Relations:** `studentBatches`, `instructorBatches`, `sessions`.
**Missing columns:** `startDate`, `endDate`, `status`, `capacity`, `description`, `createdAt`, `updatedAt`.

This is the weakest model in the schema. A "batch" in any real cohort system has a lifecycle — upcoming, running, completed — and a date range. Without them:
- Every batch appears in every dropdown forever, including cohorts that graduated last year.
- "Sessions this term" cannot be expressed.
- A student can be assigned to a batch that conceptually ended.

**Improvements:** add `startDate`/`endDate`/`status`/timestamps; make `@@unique([name, techStackId])`.

### 2.4 `StudentBatch` / `InstructorBatch` (join tables)

Composite PK `(studentId, batchId)` / `(instructorId, batchId)`, with an index on each column and `onDelete: Cascade` on both sides. Structurally correct.

**Missing:** `assignedAt`, `assignedBy`, `removedAt`. This matters more than it looks — the assignment endpoints ([batch.routes.ts:70-97](backend/src/routes/batch.routes.ts#L70-L97)) **delete every row and recreate**, so even if you added `assignedAt` today it would reset on every save. The write pattern and the schema would both need to change to support "when did this student join this cohort?"

**Also missing:** the `instructorId` column on `InstructorBatch` has **no role constraint** — nothing at the database or application level prevents assigning a `STUDENT` as an instructor of a batch. `session.service.ts` checks `role: 'INSTRUCTOR'` on session creation, but the batch assignment endpoint does not.

### 2.5 `Session`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id` | |
| `title` | `String` | |
| `description` | `String?` | |
| `batchId` / `instructorId` | `String` | Both FK, both indexed, both `onDelete: Cascade` |
| `googleEventId` | `String?` | Read on update/cancel/delete ✅ |
| `googleMeetLink` | `String?` | Displayed in UI ✅ |
| `meetingCode` | `String?` | **Written on create, never read anywhere** ⚠️ |
| `startTime` / `endTime` | `DateTime` | Stored UTC |
| `status` | `SessionStatus @default(SCHEDULED)` | `COMPLETED` is **never written by any code path** ⚠️ |
| `createdAt` / `updatedAt` | `DateTime` | |

**⚠️ `onDelete: Cascade` on `instructorId` is dangerous.** There is currently no user-delete endpoint, so it is latent — but the moment one is added, deleting an instructor silently destroys every session they ever taught *and*, by the cascade on `Session → Attendance`, every attendance record for those sessions. Historical training data would vanish. This should be `Restrict` or `SetNull`.

**Missing columns:** `cancelledAt`, `cancelledBy`, `completedAt`, `recordingUrl`, `agenda`, `materialsUrl`, `actualStartTime`.
**Missing index:** `@@index([startTime])` and `@@index([status, startTime])` — every list query orders by `startTime` and future filtering will be on status + date.
**Missing constraint:** nothing enforces `endTime > startTime` at the DB level; it is derived in code from `durationMinutes` on create but is freely writable on update.

### 2.6 `Attendance`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id` | |
| `sessionId` / `studentId` | `String` | Both FK, both indexed, both Cascade |
| `status` | `AttendanceStatus` | `PRESENT\|ABSENT\|LATE\|EXCUSED` |
| `remarks` | `String?` | Displayed ✅ |
| `markedBy` | `String` | **Plain string, no FK, never read.** Can hold arbitrary values — [verify-attendance.ts](backend/verify-attendance.ts) writes the literal `'mock-id'` |
| `createdAt` / `updatedAt` | `DateTime` | |

**Constraint:** `@@unique([sessionId, studentId])` — correctly enables the idempotent `upsert` in [attendance.service.ts:29](backend/src/services/attendance.service.ts#L29-L48). Good design.

**Missing validation (application-level, not schema):** nothing verifies the `studentId` is actually enrolled in the session's batch. An admin or instructor can mark attendance for a student who was never in that cohort.

**Improvements:** make `markedBy` a real FK relation to `User` (`markedByUser`); add `@@index([status])` for reporting; consider `markedAt` distinct from `createdAt`.

### 2.7 `StudentProgress`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id` | |
| `studentId` / `techStackId` | `String` | Both FK, both indexed, both Cascade |
| `progress` | `Int @default(0)` | **No DB-level 0–100 check** — only Zod enforces the range |
| `level` | `ProgressLevel` | Auto-derived client-side from `progress` |
| `notes` | `String?` | |
| `lastUpdated` | `DateTime @default(now())` | Manually set on update ([progress.service.ts:24](backend/src/services/progress.service.ts#L24)) rather than `@updatedAt` |

**Constraint:** `@@unique([studentId, techStackId])` — correct for the upsert pattern.

**Structural limitation:** this model is a **snapshot, not a history**. Every update overwrites. There is no way to answer "how did this student progress over the term", which is the single most valuable question a training portal can answer. Adding a `ProgressHistory` append-only table later is easy; retro-fitting the data that was overwritten is impossible. Worth doing early.

**Also:** `level` is stored but always derived from `progress` in the UI ([ProgressSliderDialog.tsx:33-38](frontend/src/components/progress/ProgressSliderDialog.tsx#L33-L38)) — it is denormalised with no server-side enforcement, so an API caller can post `progress: 5, level: 'ADVANCED'` and it will be accepted.

### 2.8 Schema summary

| Aspect | Verdict |
|---|---|
| Normalisation | ✅ Clean 3NF, no redundancy except derived `level` |
| Foreign keys | ✅ All present |
| Indexes on FKs | ✅ All present |
| Cascade rules | ⚠️ Mostly right; `Session.instructorId` cascade is a latent data-loss bug |
| Business-key uniqueness | ⚠️ `Batch.name` not unique; email not case-normalised |
| Timestamps | ⚠️ Missing on `TechStack`, `Batch`, both join tables |
| Check constraints | ❌ None (`progress` range, `endTime > startTime`) |
| Soft delete | ❌ None |
| History / audit tables | ❌ None |
| Migrations | ❌ **None — git-ignored** |

---

## 3. API AUDIT

26 endpoints across 8 routers, mounted at `/api` ([routes/index.ts](backend/src/routes/index.ts)).

**Global response envelope:** `{ success: boolean, data?: T, message?: string, errors?: [] }` — consistently applied.
**Global rate limit:** 100 requests / 15 min / IP on all `/api/*`, no per-route buckets.
**Global body limit:** 10 kB.

### 3.1 Authentication — `/api/auth`

| Method | Route | Purpose | Auth | Validation | Response | Prod ready | Error handling | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/login` | Issue JWT | Public | ✅ `loginSchema` | `{user{id,name,email,role}, token}` | ✅ | ✅ Generic 401 both branches | **No dedicated rate limit** — 100 attempts / 15 min |
| POST | `/logout` | — | Bearer | — | `{message}` | ⚠️ | n/a | Server-side no-op; token remains valid |
| GET | `/me` | Restore session | Bearer | — | `{user{id,role,status}}` | ❌ | ✅ | **Omits `name`/`email` the UI requires** — see FEATURE_INVENTORY §6.1 |

### 3.2 Users — `/api/users` (all Bearer)

| Method | Route | Purpose | Role | Validation | Prod ready | Notes |
|---|---|---|---|---|---|---|
| PATCH | `/profile` | Edit own name/password | Any | ✅ `updateProfileSchema` | ✅ | Correctly re-hashes. No current-password confirmation |
| POST | `/` | Create user | ADMIN | ✅ `createUserSchema` | ✅ | Pre-checks duplicate email → 400 |
| GET | `/` | List (opt. `?role=`) | ADMIN | ❌ query unvalidated | ⚠️ | **Unbounded.** Invalid role → Prisma error → 400 |
| GET | `/:id` | Fetch one + batches | ADMIN | ❌ `:id` unvalidated | ⚠️ | Non-UUID → Prisma error, not a clean 400 |
| PATCH | `/:id` | Update user | ADMIN | 🟡 schema exists but is bypassed | ❌ | **Mass assignment** — see §5.2 |

### 3.3 Tech Stacks — `/api/techstacks` (all Bearer)

| Method | Route | Purpose | Role | Validation | Prod ready | Notes |
|---|---|---|---|---|---|---|
| GET | `/` | List all | Any | — | ✅ | Unbounded but the table is tiny |
| POST | `/` | Create | ADMIN | ❌ manual `if(!name)` | ⚠️ | Duplicate name → raw Prisma P2002 → generic 400 |
| PATCH | `/:id` | Rename | ADMIN | ❌ manual | ⚠️ | Non-existent id → P2025 → generic 400, not 404 |
| DELETE | `/:id` | Delete | ADMIN | ❌ | ✅ | **Exemplary** P2003 handling with a human message |

### 3.4 Batches — `/api/batches` (all Bearer)

| Method | Route | Purpose | Role | Validation | Prod ready | Notes |
|---|---|---|---|---|---|---|
| GET | `/` | List, role-scoped | Any | — | ✅ | Correct scoping for INSTRUCTOR/STUDENT |
| GET | `/:id` | Fetch one + full roster | Any | ❌ | ❌ | **IDOR** — any student can read any batch's full student roster **including every email address** |
| POST | `/` | Create | ADMIN | ❌ manual | ⚠️ | Invalid `techStackId` → raw P2003 |
| POST | `/:id/students` | Replace enrolment | ADMIN | ❌ **none** | ❌ | `studentIds.map(...)` throws **500** if body is not an array. No verification the ids are STUDENTs |
| POST | `/:id/instructors` | Replace instructors | ADMIN | ❌ **none** | ❌ | Same; can assign a STUDENT as an instructor |
| PATCH | `/:id` | Update | ADMIN | ❌ manual | ⚠️ | |
| DELETE | `/:id` | Delete | ADMIN | ❌ | ✅ | P2003 handled. Note: cascades to sessions |

### 3.5 Sessions — `/api/sessions` (all Bearer)

| Method | Route | Purpose | Role | Validation | Prod ready | Notes |
|---|---|---|---|---|---|---|
| POST | `/` | Create + Meet + emails | ADMIN, INSTRUCTOR | ✅ `createSessionSchema` | ⚠️ | No past-date check. No conflict check. **An instructor may set `instructorId` to another instructor.** Google failure → 500, nothing persisted |
| GET | `/` | List, role-scoped | Any | ❌ query unvalidated | ⚠️ | Correct scoping. **Unbounded** — admins get every session ever |
| PATCH | `/:id` | Update + patch Calendar + emails | ADMIN, INSTRUCTOR | ❌ **`updateSessionSchema` exists but is not wired** | ❌ | **No ownership check.** Calendar failure logged & swallowed → DB/Calendar divergence |
| PATCH | `/:id/cancel` | Cancel + delete event + emails | ADMIN, INSTRUCTOR | ❌ | ⚠️ | **No ownership check.** Correctly rejects double-cancel |
| DELETE | `/:id` | Hard delete | ADMIN, INSTRUCTOR | ❌ | ⚠️ | **No ownership check.** Cascades away all attendance. No UI calls it |

### 3.6 Attendance — `/api/attendance` (all Bearer)

| Method | Route | Purpose | Role | Validation | Prod ready | Notes |
|---|---|---|---|---|---|---|
| GET | `/student/:studentId` | One student's history | **Any** | ❌ | ❌ | **IDOR** — registered before `restrictTo`; any student can read any other student's record |
| GET | `/overview` | All records, global | ADMIN, INSTRUCTOR | — | ❌ | **Unbounded, unscoped.** Instructors see every batch. No date filter |
| GET | `/session/:sessionId` | One session's roster | ADMIN, INSTRUCTOR | ❌ | ⚠️ | No ownership check |
| POST | `/` | Mark (upsert) | ADMIN, INSTRUCTOR | ✅ `markAttendanceSchema` | ⚠️ | Rejects cancelled sessions ✅. **No check the student is in that batch.** No bulk variant |
| PATCH | `/:id` | Update one record | ADMIN, INSTRUCTOR | ✅ | ⚠️ | No ownership check |

### 3.7 Progress — `/api/progress` (all Bearer)

| Method | Route | Purpose | Role | Validation | Prod ready | Notes |
|---|---|---|---|---|---|---|
| GET | `/student/:studentId` | One student's progress | **Any** | ❌ | ❌ | **IDOR**, same pattern as attendance |
| GET | `/overview` | All progress, global | ADMIN, INSTRUCTOR | — | ❌ | **Unbounded.** The instructor UI depends on this, so every instructor downloads every student's record |
| POST | `/` | Upsert | ADMIN, INSTRUCTOR | ✅ `updateProgressSchema` | ⚠️ | No check the student is theirs. `level` is not cross-validated against `progress` |
| PATCH | `/` | Alias of POST | ADMIN, INSTRUCTOR | ✅ | ⚠️ | Two verbs, one handler — harmless but sloppy |

### 3.8 Google — `/api/google` (**no authentication on either route**)

| Method | Route | Purpose | Auth | Prod ready | Notes |
|---|---|---|---|---|---|
| GET | `/auth` | Redirect to consent | ❌ **Public** | ❌ | Anyone can trigger the consent redirect |
| GET | `/oauth/callback` | Exchange code → tokens | ❌ **Public** | ❌ | **Returns `refresh_token` in the plaintext JSON response body.** Operator-only setup surface exposed publicly |

### 3.9 Health

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | Public | Registered **after** `app.use('/api', limiter)`, so platform health checks consume the same 100/15 min bucket |
| GET | `/health` | Public | Duplicate, outside the limiter |

### 3.10 Cross-cutting API findings

| # | Finding | Severity |
|---|---|---|
| A1 | **`validate()` discards its parsed output.** [validate.middleware.ts:7-11](backend/src/middlewares/validate.middleware.ts#L7-L11) parses `{body, query, params}` into a throwaway value and never assigns back to `req`. Zod's default strip-unknown-keys behaviour therefore provides **zero** protection — every extra field survives into the handler | **High** |
| A2 | 9 of 26 endpoints have no request validation at all | High |
| A3 | No pagination on any list endpoint | High |
| A4 | No ownership authorization on any mutation | High |
| A5 | Path params are never UUID-validated except on 3 routes, so malformed ids surface as Prisma errors rather than clean 404s | Medium |
| A6 | No API versioning (`/api/v1`) | Low |
| A7 | No OpenAPI spec | Medium |
| A8 | No request-ID correlation header | Medium |

---

## 4. UI AUDIT

18 route-mapped screens. Tailwind + shadcn/ui. No component tests, no Storybook.

### 4.1 Per-page assessment

| Page | Purpose | Implemented | Missing | Loading | Empty | Error | Responsive | A11y | Prod ready |
|---|---|---|---|---|---|---|---|---|---|
| [Login](frontend/src/pages/Login.tsx) | Auth entry | RHF+zod form, inline errors, auto-redirect if already authed | Forgot-password, show-password toggle, submit spinner | ❌ no pending state | n/a | ✅ inline banner | ✅ | 🟡 labels ✅, no `aria-invalid` | ✅ |
| [AdminDashboard](frontend/src/pages/AdminDashboard.tsx) | Overview + quick schedule | 4 tiles, session table, schedule dialog | Charts, trends, date range | ❌ **none** — tiles render `0` while loading | ✅ table row | ❌ **`alert()`** | 🟡 raw `<table>` doesn't scroll | ❌ native `<select>` unlabelled | ⚠️ |
| [InstructorDashboard](frontend/src/pages/InstructorDashboard.tsx) | Instructor home | Sessions, batches, derived students, schedule dialog | Edit/cancel own sessions | ❌ | ✅ good icon+text states | ✅ inline banner | ✅ | 🟡 | ✅ |
| [StudentDashboard](frontend/src/pages/StudentDashboard.tsx) | Student home | Attendance %, classes, progress bars | Attendance detail, history | ❌ | ✅ | ❌ none | ✅ | 🟡 progress bars are pure `<div>`, no `role="progressbar"` | ✅ |
| [StudentsManagement](frontend/src/pages/admin/StudentsManagement.tsx) | Student CRUD | Table, search, create/edit, activate | Pagination, bulk, sort, export | ✅ text | ✅ | ❌ **mutation errors silently swallowed** | ✅ | 🟡 | ⚠️ |
| [InstructorsManagement](frontend/src/pages/admin/InstructorsManagement.tsx) | Instructor CRUD | — identical to above — | — | ✅ | ✅ | ❌ same | ✅ | 🟡 | ⚠️ |
| [TechStacksManagement](frontend/src/pages/admin/TechStacksManagement.tsx) | Tech stack CRUD | Table, search, CRUD, delete confirm | Description field | ✅ | ✅ | ✅ `globalError` banner | ✅ | 🟡 | ✅ |
| [BatchesManagement](frontend/src/pages/admin/BatchesManagement.tsx) | Batch CRUD + assignment | CRUD, dual assign dialogs, delete confirm | Pagination, batch detail view | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| [SessionsManagement](frontend/src/pages/admin/SessionsManagement.tsx) | Session lifecycle | Table, search, view/edit/cancel, confirm | Filters, date range, pagination, delete | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| [AdminAttendance](frontend/src/pages/admin/AdminAttendance.tsx) | Attendance report | 4 tiles, full log table | **Filters, date range, export, pagination** | ✅ | ✅ | ❌ none | ✅ `overflow-x-auto` | 🟡 | ⚠️ |
| [AdminProgress](frontend/src/pages/admin/AdminProgress.tsx) | Progress report | 4 tiles, table with bars | Same as above | ✅ | ✅ | ❌ none | ✅ | 🟡 | ⚠️ |
| [InstructorAttendance](frontend/src/pages/InstructorAttendance.tsx) | Mark attendance | Session cards → roster dialog | Date filter, past-session grouping | ✅ | ✅ | ❌ none | ✅ | 🟡 | ✅ |
| [InstructorProgress](frontend/src/pages/InstructorProgress.tsx) | Update progress | Student cards, per-stack bars, slider dialog | Search, sort by at-risk | ✅ partial | ✅ | ❌ none | ✅ | 🟡 | ⚠️ |
| [ProfilePage](frontend/src/pages/ProfilePage.tsx) | Self-service | Name/password form, success+error banners | Current-password confirm, avatar | n/a | n/a | ✅ | ✅ | ✅ best on the site | ⚠️ shows blank email after refresh (§6.1) |
| [PlaceholderPage](frontend/src/pages/PlaceholderPage.tsx) | Stub | Static text | Everything | n/a | n/a | n/a | ✅ | ✅ | 🔴 |
| [NotFoundPage](frontend/src/pages/NotFoundPage.tsx) | 404 | Message + CTA | — | n/a | n/a | n/a | ✅ | ✅ | ✅ |
| [UnauthorizedPage](frontend/src/pages/UnauthorizedPage.tsx) | 403 | Message + CTA | — | n/a | n/a | n/a | ✅ | ✅ | ✅ |
| [DashboardLayout](frontend/src/layouts/DashboardLayout.tsx) | Shell + guard | Sidebar, header, role guard | User menu, notifications, breadcrumbs | ✅ text | n/a | n/a | ✅ | ✅ | ⚠️ header shows `Hello, undefined` after refresh |

### 4.2 Systemic UI issues

1. **No toast/notification system.** Feedback is one of: `alert()` (AdminDashboard), an inline red `<div>` (5 pages), or **nothing at all** (Students/Instructors management, all attendance and progress mutations). A failed attendance save on `InstructorAttendance` closes the dialog with no signal either way.
2. **No React error boundary**, despite [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) asserting one exists. Any render-time throw produces a blank white page.
3. **Loading states are inconsistent.** Three of the dashboards render `0`/empty content during fetch rather than a skeleton — `ui/skeleton.tsx` is installed and used only internally by the sidebar.
4. **Accessibility is adequate but not audited.** Radix primitives supply focus management, `aria-*`, and keyboard handling for dialogs/dropdowns/selects. Hand-rolled elements do not: the `AdminDashboard` native `<select>`s lack `id`/`htmlFor` pairing, progress bars have no ARIA role or value, radio groups in the attendance dialog have no `<fieldset>`/`<legend>`, and status is conveyed by colour alone in several tables.
5. **Dark mode is configured and unimplemented** — `darkMode: ["class"]` plus a full dark CSS-variable block in `index.css`, but **zero `dark:` utility classes** across the entire codebase and no toggle.
6. **Two session-creation dialogs** with different validation and different UX ship simultaneously.
7. **`Session` and `User` are typed; everything else is `any`.** `AttendanceFormDialog`, `ProgressSliderDialog`, and every `map((s: any) => ...)` in the dashboards discard type safety at exactly the boundary where the API contract matters most.

---

## 5. AUTHORIZATION AUDIT

### 5.1 Model

**Roles:** `ADMIN`, `INSTRUCTOR`, `STUDENT`. No super-admin, no custom roles, no per-resource grants. Role is assigned at creation and is only mutable through the mass-assignment path (§5.2) or the `updateUserSchema`, which does permit `role` — so an admin can promote anyone, but there is no UI for it.

**Enforcement points:**
1. `authenticate` — verifies JWT, re-reads the user from the DB, rejects deleted or deactivated accounts ([auth.middleware.ts:14-47](backend/src/middlewares/auth.middleware.ts#L14-L47)).
2. `restrictTo(...roles)` — coarse role gate ([auth.middleware.ts:49-56](backend/src/middlewares/auth.middleware.ts#L49-L56)).
3. Ad-hoc query scoping in two places ([batch.routes.ts:12-19](backend/src/routes/batch.routes.ts#L12-L19), [session.controller.ts:17-26](backend/src/controllers/session.controller.ts#L17-L26)).
4. Frontend `allowedRoles` guard — UX only, not a security boundary.

**What does not exist:** any ownership check, any policy/ability abstraction, any place to put one.

### 5.2 Findings

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| **Z1** | **Horizontal privilege escalation between instructors.** Any instructor can `PATCH`, cancel, or `DELETE` any session by id — including retiming another cohort's class and triggering cancellation emails to students they do not teach | **High** | [session.routes.ts:29-36](backend/src/routes/session.routes.ts#L29-L36) |
| **Z2** | **IDOR on student records.** `GET /attendance/student/:id` and `GET /progress/student/:id` sit above the `restrictTo` gate. Any authenticated student can enumerate any other student's attendance and progress, including private instructor notes | **High** | [attendance.routes.ts:18](backend/src/routes/attendance.routes.ts#L18), [progress.routes.ts:16](backend/src/routes/progress.routes.ts#L16) |
| **Z3** | **PII exposure via `GET /batches/:id`.** Returns the full student roster with email addresses to **any** authenticated user, including students | **High** | [batch.routes.ts:35-53](backend/src/routes/batch.routes.ts#L35-L53) |
| **Z4** | **Mass assignment on `PATCH /users/:id`.** `validate()` never writes its parsed output back to `req.body`, and the controller forwards raw `req.body` as `Prisma.UserUpdateInput`. `{"password":"x"}` writes plaintext, permanently locking the account out of login | **High** | [validate.middleware.ts:7](backend/src/middlewares/validate.middleware.ts#L7-L11), [user.service.ts:74-94](backend/src/services/user.service.ts#L74-L94) |
| **Z5** | Instructors can create sessions naming **another** instructor, and for **any** batch — including batches they are not assigned to | Medium | [session.service.ts:7](backend/src/services/session.service.ts#L7-L32) |
| **Z6** | `/attendance/overview` and `/progress/overview` return **global** data to instructors. The instructor progress page is built on this | Medium | [InstructorProgress.tsx:41-44](frontend/src/pages/InstructorProgress.tsx#L41-L44) |
| **Z7** | Attendance can be marked for a student not enrolled in that session's batch | Medium | [attendance.service.ts:6-51](backend/src/services/attendance.service.ts#L6-L51) |
| **Z8** | `POST /batches/:id/instructors` does not verify the ids are `INSTRUCTOR`s | Low | [batch.routes.ts:85-97](backend/src/routes/batch.routes.ts#L85-L97) |

### 5.3 JWT & session management

| Aspect | Implementation | Assessment |
|---|---|---|
| Algorithm | HS256 (library default) | ✅ Fine for a single-service monolith |
| Payload | `{id, role, iat, exp}` | ⚠️ `role` is embedded, so a demotion does not take effect until the token expires (up to 24 h). The DB re-read only revalidates existence and `status`, **not** role |
| Expiry | `JWT_EXPIRES_IN` default `1d` | ⚠️ Long for a token with no revocation |
| Secret | Required; process exits if absent | ✅ [jwt.ts:5-7](backend/src/utils/jwt.ts#L5-L7) |
| Claims | No `iss`, `aud`, `jti`, `sub` | ⚠️ No `jti` means per-token revocation is impossible even if a denylist were added |
| Refresh tokens | **None** | ❌ Users are hard-logged-out at 24 h |
| Revocation / denylist | **None** | ❌ `logout` is a client-side localStorage delete only |
| Storage | `localStorage` | ⚠️ XSS-readable. `httpOnly` cookie + CSRF token is the stronger pattern |
| Transport | `Authorization: Bearer` | ✅ |
| Concurrent sessions | Unlimited, untracked | ⚠️ No "sign out other devices" |

**Mitigating factor worth crediting:** because `authenticate` re-reads the user on every request, **deactivating an account takes effect immediately** despite the absence of a denylist. That covers the most important revocation case (offboarding) — just not role changes or stolen-token containment.

---

## 6. GOOGLE INTEGRATIONS

### 6.1 OAuth

Single shared Google account. One OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), **two independently scoped refresh tokens**:

| Token | Scope | Used by |
|---|---|---|
| `GOOGLE_REFRESH_TOKEN` | `calendar.events` | [google.service.ts](backend/src/services/google.service.ts) |
| `GMAIL_REFRESH_TOKEN` | `gmail.send` | [GmailApiMailer.ts](backend/src/services/email/GmailApiMailer.ts) |

Keeping them separate is **correct and deliberate** — a refresh token is bound to the scopes it was granted, so re-consenting for Gmail would otherwise invalidate or re-scope the Calendar token. The reasoning is documented in the file header. Least privilege is respected: `gmail.send` only, no read/modify/delete.

Tokens are stored in environment variables, obtained manually via `npm run gmail:auth` or `GET /api/google/auth`, and pasted in by an operator. There is **no token persistence, no automatic refresh-token rotation handling, and no alerting on `invalid_grant`** — if Google revokes the token, the failure surfaces only in logs and (for Calendar) as a 500 on every session creation.

### 6.2 Calendar API

| Operation | Implementation | Robustness |
|---|---|---|
| Create | `events.insert`, `conferenceDataVersion: 1`, `hangoutsMeet` request | 10 s timeout via `Promise.race`. Extracts `hangoutLink` + meeting code. **Throws on failure → aborts session creation** |
| Update | `events.patch` (summary, description, start, end) | Throws → caught and **swallowed** by the caller, DB already committed |
| Delete | `events.delete` | Catches internally, returns `false`, never throws |

**Guest list (uncommitted change):** [google.service.ts:92-107](backend/src/services/google.service.ts#L92-L107) now adds the instructor plus every batch student as `attendees`, with `guestsCanInviteOthers: false` and `guestsCanSeeOtherGuests: false`, and `sendUpdates: 'none'` to avoid duplicating the app's own notification email. This fixes a real defect — previously nobody was on the guest list, so on a personal-account Meet every participant would have had to knock, and the organizer account never joins the call to admit them. Documented in [docs/google-meet-cohost-feasibility.md §8a](docs/google-meet-cohost-feasibility.md).

**Timezone handling:** `startTime` arrives as an ISO string from a `datetime-local` input converted through `new Date(...).toISOString()`. The Calendar payload sends `dateTime` with the UTC `Z` offset and **no `timeZone` field**. This is valid — an offset-bearing RFC3339 timestamp is unambiguous — but it means the event carries no named timezone, so a DST-crossing recurring series (if ever added) would drift. Fine as-is for one-off events.

### 6.3 Retry & failure handling

| Path | Retry | Timeout | On failure |
|---|---|---|---|
| Calendar create | ❌ none | ✅ 10 s | **500, transaction aborted, nothing saved** |
| Calendar update | ❌ none | ❌ none | Logged, swallowed → **DB/Calendar divergence** |
| Calendar delete | ❌ none | ❌ none | Logged, returns `false`, ignored → **orphaned calendar events** |
| Gmail API send | ❌ none | ❌ none | Classified, logged, message dropped |

There is **no retry logic anywhere in the Google integration** and no reconciliation job to detect divergence.

### 6.4 Current limitations (upstream, not fixable in code)

[docs/google-meet-cohost-feasibility.md](docs/google-meet-cohost-feasibility.md) is a genuinely rigorous piece of work and its conclusions should be treated as settled:

- **Co-host assignment is impossible** — blocked by an account-level licensing limit (free Gmail has no co-host feature) **and**, independently, an API-level limit (neither Calendar `attendees[]`/`conferenceData` nor Meet REST v2 exposes any host-assignment field). Paying for Workspace fixes the first, not the second.
- **Recording is impossible** — paid entitlement, and there is no public start/stop API at any tier.
- **Meet REST API is unreachable** — it requires a Workspace account; the backend uses `gmail.com`.
- **The only path to real host powers** is option 8b: make each instructor the event organizer using their own OAuth token. This works on free Gmail, needs no Workspace, and is correctly flagged as a product decision (it relaxes the "one shared account" constraint) rather than silently shipped.

The document is explicit that nothing fake was added to simulate co-host behaviour. That restraint is the right call.

### 6.5 Production readiness — Google

**7/10.** The happy path is solid and the mock mode makes local development pleasant. Deductions: no retry, no reconciliation, hard-failure coupling to session creation, no token-expiry alerting, and publicly exposed OAuth bootstrap endpoints.

---

## 7. EMAIL SYSTEM

**This is the strongest subsystem in the repository** and is markedly more mature than the code around it.

### 7.1 Architecture

```
EmailService.sendSessionNotification / …Update… / …Cancellation…
        │  builds an EmailMessage {to, subject, text, label, operation, unaffected[]}
        ▼
EmailService.dispatch(message)          ← never throws, always resolves
        │
   EMAIL_TRANSPORT = ?
        ├── 'gmail_api' ──▶ GmailApiMailer.send()
        ├── 'smtp'      ──▶ SmtpMailer.send()
        └── 'auto'      ──▶ SmtpMailer.send({fallbackAvailable})
                                 │
                     delivered? ─┴─ yes ─▶ done
                                    no
                                    │
                          failure is network-class?
                          (CONNECTION_TIMEOUT | NETWORK_UNREACHABLE)
                                ├── no  ─▶ STOP. Log "this is a config issue,
                                │           fix SMTP" — do NOT mask it
                                └── yes ─▶ GmailApiMailer.send() over HTTPS/443
```

### 7.2 The design decision that makes this good

[email.service.ts:62-68](backend/src/services/email.service.ts#L62-L68) falls back **only** when the failure is network-level. An authentication error, a TLS mismatch, or a rejected recipient does *not* trigger the fallback — because papering over a configuration bug with a second transport hides a defect that needs fixing. Most fallback implementations get this wrong.

The stated rationale for the whole design is equally sound: Render's free instances firewall outbound SMTP ports 25/465/587, so the Gmail API over 443 is not a second *vendor*, it is the same Gmail account reached by a different transport.

### 7.3 SMTP transport — [SmtpMailer.ts](backend/src/services/email/SmtpMailer.ts)

| Feature | Detail |
|---|---|
| IPv4 pinning | nodemailer 9 ignores its own `family` option and picks randomly from the combined A/AAAA list. The mailer resolves the host itself and pins one address, keeping `servername` for SNI/cert validation. **A subtle bug correctly diagnosed and worked around** |
| TLS | `requireTLS` on 587 (never falls back to cleartext), `minVersion: TLSv1.2` |
| Circuit breaker | After a connection-level failure, sends short-circuit for `SMTP_RETRY_COOLDOWN` (default 10 min) instead of parking a socket for the full 15 s timeout per email. Resets on first success |
| Timeouts | Connection 15 s / greeting 10 s / socket 25 s, all env-tunable |
| Handshake debug | `SMTP_DEBUG=true` logs the full connect→EHLO→STARTTLS→AUTH→DATA sequence; nodemailer masks AUTH payloads so credentials never appear |
| Credential hygiene | The password is never printed — only its character count |

### 7.4 Gmail API transport — [GmailApiMailer.ts](backend/src/services/email/GmailApiMailer.ts)

RFC 5322 message construction, base64url encoding, RFC 2047 Subject encoding so non-ASCII session titles survive. `verify()` via `users.getProfile` for startup checks without sending. The error classifier flattens **two different Google error shapes** (the OAuth token endpoint's `{error: 'invalid_grant'}` vs. the Gmail API's `{error: {code, message}}`) and maps 401/403-scope/403-API-disabled/429/5xx to distinct, actionable messages.

### 7.5 Diagnostics — [smtpDiagnostics.ts](backend/src/services/email/smtpDiagnostics.ts)

Seven failure classes (`DNS_FAILURE`, `AUTH_FAILURE`, `TLS_FAILURE`, `CONNECTION_TIMEOUT`, `NETWORK_UNREACHABLE`, `SMTP_REJECTED`, `UNKNOWN_ERROR`), each with a reason, a "what to check" line, and the raw error fields.

At startup, if the failure looks like a blocked port, [SmtpMailer.probeEgress](backend/src/services/email/SmtpMailer.ts#L346-L386) runs **raw TCP probes** against `smtp.gmail.com:587`, `:465`, and `www.google.com:443`, then concludes in plain language whether the platform firewall is the boundary, the environment has no outbound network at all, or the failure is above the network layer. It then arms the circuit breaker so the first post-boot emails fail instantly rather than timing out.

This is better operational tooling than most production services have. It is also non-blocking — [server.ts:21-23](backend/src/server.ts#L21-L23) fires it after `listen()` and never awaits it, so an unreachable SMTP host cannot delay startup.

### 7.6 Templates

Three plaintext templates in [email.service.ts](backend/src/services/email.service.ts): session created, session updated, session cancelled. Each carries a `unaffected[]` list that is printed on failure ("Google Meet has already been created successfully…") so an operator reading logs immediately knows the business transaction succeeded.

**Gaps:** no HTML, no branding, no `.ics` attachment, no unsubscribe, no localisation, no reminder template. Dates are formatted with `Intl.DateTimeFormat('en-US')` using the **server's** timezone ([email.service.ts:77-82](backend/src/services/email.service.ts#L77-L82)) — on Render that is UTC, so recipients in IST see UTC times with no timezone label. **This is a real user-facing defect.**

### 7.7 Queue, retry, and the honest weakness

| Capability | Status |
|---|---|
| Queue / outbox | ❌ **None** |
| Retry | ❌ **None — one attempt per message** |
| Persistence of failures | ❌ None — a dropped notification exists only as a log line |
| Dead-letter | ❌ None |
| Delivery tracking | ❌ No `sent`/`failed` record anywhere |
| Bounce handling | ❌ None |
| Per-recipient isolation | ❌ All recipients on one `To:` header — **every student sees every other student's address** |
| Rate/quota awareness | 🟡 429 is classified but not throttled. Gmail consumer limit ≈500 recipients/day |

For a portal notifying a handful of cohorts this is acceptable. It becomes the binding constraint the moment reliability of notification matters, and the *lack of retry is by far the largest gap in an otherwise excellent subsystem*. The BCC issue is a privacy defect that should be fixed regardless of scale.

### 7.8 Production readiness — Email

**8.5/10.** Transport, diagnostics, and failure isolation are production-grade. Deductions: no retry/queue, recipient-address leakage, timezone-less date formatting, plaintext-only templates.

---

## 8. BACKGROUND SERVICES

**There are none.**

Verified absent: no `node-cron`, `bull`, `bullmq`, `agenda`, `redis`, or any scheduler dependency in [backend/package.json](backend/package.json); no `setInterval` in `src/`; no worker process; no `railway`/`render` cron declaration.

| Would-be job | Purpose | Currently |
|---|---|---|
| Session auto-completion | Flip `SCHEDULED` → `COMPLETED` after `endTime` | ❌ `COMPLETED` is **never written** — the enum, validator entry, and two UI badges are dead |
| Class reminders | T-24 h and T-15 min emails | ❌ Absent. The highest-value use of the existing email infrastructure |
| Email retry sweep | Re-attempt failed notifications | ❌ Absent (nothing is persisted to retry) |
| Calendar reconciliation | Detect DB↔Google divergence from swallowed update/delete failures | ❌ Absent |
| Token health check | Alert before/when a Google refresh token dies | ❌ Absent |
| Data retention / cleanup | Archive old sessions, purge orphans | ❌ Absent |
| Digest reports | Weekly attendance summary to admins | ❌ Absent |

**The only recurring work in the process** is the fire-and-forget startup diagnostics run ([server.ts:21-23](backend/src/server.ts#L21-L23)) — once per boot, not recurring.

**Blocking consideration for Render free tier:** free web services sleep after inactivity, so an in-process scheduler would not fire reliably. A reminder feature therefore needs either a paid instance, an external cron pinging an authenticated endpoint, or a separate worker — this is an infrastructure decision, not just a code one.

---

## 9. ERROR HANDLING

### 9.1 What works

| Mechanism | Assessment |
|---|---|
| [`AppError`](backend/src/utils/AppError.ts) | Clean operational-error class with `statusCode` and `isOperational`, correct `captureStackTrace` |
| [`asyncHandler`](backend/src/utils/asyncHandler.ts) | Correct — every async controller is wrapped, so no unhandled rejection escapes to Express |
| [`errorHandler`](backend/src/middlewares/error.middleware.ts) | Handles Zod → 400 with field paths, `AppError` → its own status, `PrismaClientValidationError` / `PrismaClientKnownRequestError` → 400, unknown → 500 |
| Production redaction | Internal messages and Prisma details are replaced with generic text when `NODE_ENV === 'production'` ✅ |
| Email failure isolation | Every mail path resolves; failures print an explicit "this does NOT affect session creation" footer listing what already succeeded ✅ |
| Process handlers | `SIGTERM`/`SIGINT` graceful shutdown; `unhandledRejection` logged ✅ |

### 9.2 What does not

| # | Issue | Impact |
|---|---|---|
| E1 | **No structured logging.** 168 `console.*` calls, no levels, no request IDs, no JSON. Correlating a user report to a log line means grepping timestamps | High |
| E2 | **No APM / error tracking.** No Sentry, no Datadog, no OpenTelemetry. Production errors are discovered by reading Render logs manually | High |
| E3 | **Prisma errors map to a blanket 400.** `P2025` (record not found) returns 400 instead of 404; `P2002` (unique violation) returns a generic message instead of naming the conflicting field. Only `techstack.routes.ts` and `batch.routes.ts` handle a specific code (`P2003`) — and they do it well, proving the pattern is understood but unapplied | Medium |
| E4 | **`unhandledRejection` does not exit.** The handler logs and explicitly comments "Optional: In production you might want to shutdown" ([server.ts:52-55](backend/src/server.ts#L52-L55)). The process can continue in an indeterminate state | Medium |
| E5 | **No React error boundary** — despite the deployment checklist claiming one | Medium |
| E6 | **Frontend mutation errors are silently dropped** on the two user-management pages and on every attendance/progress mutation | Medium |
| E7 | **Swallowed Calendar failures create silent divergence.** `updateSession` logs and continues after a Calendar patch failure ([session.service.ts:193-196](backend/src/services/session.service.ts#L193-L196)); `deleteMeetEvent` returns `false` and the caller ignores it. Nothing detects or repairs this | Medium |
| E8 | **Verbose per-request console output in production.** Session creation alone prints ~12 lines including full Google payload timing. On Render this is real log-volume cost and noise | Low |
| E9 | **No log redaction policy.** Emails are printed in recipient counts (good) but recipient addresses appear in `info.rejected` output; error stacks are printed wholesale in the error handler | Low |

### 9.3 Validation coverage

| Layer | Coverage |
|---|---|
| Frontend (zod + RHF) | ✅ Login, User form, Session form, Profile. ❌ Progress dialog, Attendance dialog, Batch assignment — all uncontrolled `useState` |
| Backend Zod | ✅ 8 endpoints. ❌ 18 endpoints, of which 9 have **no validation of any kind** |
| **Zod effectiveness** | ⚠️ **Compromised globally** — `validate()` discards its parsed output, so unknown-key stripping never takes effect (§3.10 A1) |
| Database | ⚠️ FKs and uniques only. No check constraints (`progress` 0–100, `endTime > startTime`) |

---

## 10. SECURITY AUDIT

### 10.1 Findings by severity

#### High

| ID | Finding | Location | Notes |
|---|---|---|---|
| S1 | **Mass assignment / plaintext password write** on `PATCH /users/:id` | [validate.middleware.ts:7](backend/src/middlewares/validate.middleware.ts#L7-L11) + [user.service.ts:74](backend/src/services/user.service.ts#L74-L94) | ADMIN-only, so it is an integrity bug rather than escalation — but `{"password":"x"}` writes unhashed and permanently locks the account out |
| S2 | **IDOR on `/attendance/student/:id` and `/progress/student/:id`** | [attendance.routes.ts:18](backend/src/routes/attendance.routes.ts#L18), [progress.routes.ts:16](backend/src/routes/progress.routes.ts#L16) | Any student reads any student's record incl. private instructor notes |
| S3 | **Roster + email PII exposure via `GET /batches/:id`** | [batch.routes.ts:35](backend/src/routes/batch.routes.ts#L35-L53) | Any authenticated user, any batch |
| S4 | **Horizontal escalation between instructors** on session edit/cancel/delete | [session.routes.ts:29-36](backend/src/routes/session.routes.ts#L29-L36) | Includes triggering cancellation emails to another cohort |
| S5 | **Unauthenticated OAuth endpoints returning a refresh token in the response body** | [google.routes.ts](backend/src/routes/google.routes.ts) | Publicly reachable operator surface |

#### Medium

| ID | Finding | Location |
|---|---|---|
| S6 | **JWT in `localStorage`** — XSS-readable, no `httpOnly` protection | [AuthContext.tsx:26](frontend/src/contexts/AuthContext.tsx#L26) |
| S7 | **No token revocation.** `logout` is a client-side delete; a stolen token is valid until expiry (default 24 h) | [auth.controller.ts:15](backend/src/controllers/auth.controller.ts#L15-L22) |
| S8 | **`role` is trusted from the JWT payload**, so a demotion does not take effect for up to 24 h even though the DB is re-read every request | [auth.middleware.ts:26-42](backend/src/middlewares/auth.middleware.ts#L26-L42) |
| S9 | **No login-specific rate limit.** 100 attempts / 15 min / IP against unlimited accounts, with no lockout, no CAPTCHA, no failed-attempt tracking | [app.ts:26-31](backend/src/app.ts#L26-L31) |
| S10 | **CORS defaults to `origin: '*'` with `credentials: true`** if `CORS_ORIGIN` is unset. Browsers reject that combination for cookies, but the app uses Bearer tokens, so any origin can call the API | [app.ts:18-23](backend/src/app.ts#L18-L23) |
| S11 | **Seed credentials `admin@example.com` / `admin123`** are hardcoded and the seed is idempotent-by-email, so re-running against production silently does nothing — but a first run creates a trivially guessable admin | [seed.ts:13](backend/prisma/seed.ts#L13) |
| S12 | **All recipients on one `To:` header** — cross-student email disclosure on every notification | [SmtpMailer.ts:223](backend/src/services/email/SmtpMailer.ts#L223) |
| S13 | **No password policy** beyond `min(6)` — no complexity, no breach check, no rotation, no history | [user.validator.ts:7](backend/src/validators/user.validator.ts#L7) |
| S14 | **Profile password change requires no current-password confirmation** — a hijacked session can permanently take over the account | [user.service.ts:96](backend/src/services/user.service.ts#L96-L122) |
| S15 | **`backend/dist/` committed to git** (36 stale files predating the `services/email/` refactor). Not a secret leak, but it is untrusted build output in version control | `git ls-files backend/dist` |

#### Low / informational

| ID | Finding |
|---|---|
| S16 | No Content-Security-Policy tuning — helmet defaults only, no `frame-ancestors`/`report-uri` |
| S17 | No `X-Request-Id` correlation; no audit trail of any privileged action |
| S18 | Error stacks printed wholesale in non-production; verbose Google payload logging in all environments |
| S19 | Health endpoints leak `process.uptime()` — trivial, but unnecessary |
| S20 | No dependency scanning, no `npm audit` in CI, no Dependabot |
| S21 | `.env` is correctly git-ignored and **not** tracked ✅ — verified |

### 10.2 Category-by-category

| Category | Verdict | Detail |
|---|---|---|
| **Authentication** | 🟢 Good | bcrypt cost 10, generic error on both failure branches, inactive users rejected, secret required at boot, per-request DB revalidation |
| **Authorization** | 🔴 Weak | Role gates only. Zero ownership checks. Four High findings |
| **Secrets** | 🟢 Good | `.env` git-ignored and untracked; passwords/tokens never printed (only lengths); `.env.example` is comprehensive and placeholder-only |
| **Environment vars** | 🟢 Good | Fail-fast on required, warn on optional — the split is exactly right |
| **Input validation** | 🟡 Mixed | Good schemas, but 18 endpoints unvalidated **and** the middleware discards its own output |
| **SQL injection** | 🟢 Safe | Prisma parameterises everything. **Zero `$queryRaw`/`$executeRaw` in the codebase** — verified |
| **XSS** | 🟢 Safe | React escapes by default. **No `dangerouslySetInnerHTML` anywhere** — verified. Weakened only by JWT-in-localStorage if an XSS ever appears |
| **CSRF** | 🟢 N/A | Bearer-token auth with no cookies means no ambient credential to forge |
| **Rate limiting** | 🟡 Partial | One global bucket; nothing stricter on login; health checks share the bucket |
| **CORS** | 🟡 Partial | Correct when configured; unsafe default when not |
| **Sensitive logging** | 🟡 Partial | Credentials are protected deliberately; recipient addresses and full stacks are not |
| **Password handling** | 🟡 Partial | Hashing is correct everywhere it is intentional — undermined by the S1 mass-assignment path |
| **Token storage** | 🟡 Partial | `localStorage`, no revocation, no refresh |
| **Transport** | 🟢 Good | HTTPS enforced by Render/Vercel; SMTP requires TLS ≥1.2 |
| **Dependencies** | 🟡 Unknown | Modern versions throughout; **no scanning configured** |

### 10.3 Security score

| Category | Weight | Score |
|---|---|---|
| Authentication | 15 | 12 / 15 |
| Authorization | 20 | 7 / 20 |
| Input validation | 15 | 9 / 15 |
| Injection defence (SQLi/XSS/CSRF) | 15 | 14 / 15 |
| Secrets & config | 10 | 9 / 10 |
| Transport & headers | 10 | 8 / 10 |
| Rate limiting & abuse | 5 | 3 / 5 |
| Logging, audit & monitoring | 10 | 3 / 10 |

### **SECURITY SCORE: 65 / 100**

The foundations are sound — no injection surface, correct secret hygiene, correct password hashing, correct fail-fast. The score is held down almost entirely by **one missing layer: resource-level authorization** (−13 alone), compounded by the absence of any audit trail or monitoring. Fixing ownership checks and the `validate()` middleware bug would move this to roughly 80 with a few days of work.

---

## 11. PERFORMANCE AUDIT

### 11.1 Database queries

**N+1 problems: none found.** Every relation is loaded with Prisma `include`, which compiles to joins or batched queries. [session.service.ts:20-32](backend/src/services/session.service.ts#L20-L32) even parallelises the two independent lookups with `Promise.all`. This is genuinely well done.

**The real problem is the opposite — over-fetching:**

| Query | Issue |
|---|---|
| `GET /batches` | Includes every `studentBatch` → `student` (full object, minus password) and every `instructorBatch` for **every** batch. With 20 batches × 30 students that is 600 nested user objects per request. Called on 4 different pages |
| `GET /attendance/overview` | **Every attendance row ever written**, each with its session, that session's batch, and the student. Grows without bound; the client then computes 4 counters from it |
| `GET /progress/overview` | Every progress row, with student, that student's batch memberships, and tech stack. **The instructor progress page calls this**, so every instructor pulls the entire org's progress data |
| `GET /sessions` (admin) | Every session ever created, ordered ascending by `startTime` — so the most relevant rows are last |
| `GET /users` | Every user |

**Not one list endpoint has a `take`/`skip`.** All aggregation happens in the browser.

### 11.2 Indexes

Present and correct on every foreign key and every composite unique. Missing where future filtering will land:

- `User.role` — the most common list filter
- `Session.startTime` and `(status, startTime)` — every list orders by `startTime`
- `Attendance.status`, `StudentProgress.progress` — both used for reporting aggregates
- `Session.googleEventId` — needed if reconciliation is ever built

### 11.3 Request-path latency

Session creation is the heaviest write and is **fully instrumented** with `performance.now()` checkpoints ([session.service.ts:15-123](backend/src/services/session.service.ts#L15-L123)) — a good instinct.

```
DB validation (parallel)   ~ 50–150 ms
Google Calendar insert     ~ 300–2000 ms   ← dominant, 10 s timeout
DB insert                  ~  30–100 ms
Email trigger              ~   0 ms        ← fire-and-forget ✅
```

**The Google call is synchronous and blocking**, so p99 session creation is bounded by Google's p99 — up to 10 s before it times out and 500s. Email is correctly detached; Calendar is not.

### 11.4 Caching

**None at any layer.** No Redis, no in-memory cache, no HTTP `Cache-Control`, no ETags. TanStack Query provides client-side caching with default settings only — no `staleTime` is configured anywhere, so every mount refetches.

**Duplicate fetching across the app:** `['batches']`, `['users','STUDENT']`, `['users','INSTRUCTOR']`, and `['sessions']` are each fetched by 3–4 different pages with inconsistent query keys (`['sessions']` vs `['sessions', user?.id]` for the same endpoint), which fragments the cache and causes redundant network calls.

### 11.5 Payload sizes

| Endpoint | Est. payload at 50 students / 20 batches / 200 sessions |
|---|---|
| `GET /batches` | ~150–400 kB |
| `GET /attendance/overview` | ~500 kB – 2 MB (grows forever) |
| `GET /progress/overview` | ~200–600 kB |
| `GET /sessions` | ~100–300 kB |

Gzip via `compression()` helps (JSON compresses ~80 %), but the parse and render cost on the client does not compress.

### 11.6 Frontend

| Aspect | Status |
|---|---|
| Code splitting | ✅ All 17 routes lazy-loaded |
| Bundle analysis | ❌ Never measured |
| List virtualisation | ❌ None — a 5000-row attendance table renders 5000 DOM nodes |
| Memoisation | ❌ No `useMemo`/`useCallback`; the `Map`-building loops in `InstructorDashboard` and `InstructorProgress` re-run on every render |
| Image optimisation | n/a — no images used |
| `staleTime` / prefetch | ❌ Defaults only |
| Debounced search | ❌ Filters run on every keystroke over the full array |

### 11.7 Backend runtime

| Aspect | Status |
|---|---|
| Compression | ✅ gzip enabled |
| Body limit | ✅ 10 kB |
| Connection pooling | ✅ `pg.Pool` + Supabase pgBouncer. **Pool size is never configured** — defaults to 10, which may not match the Render instance |
| Prisma driver adapter | ✅ Modern v7 setup |
| Clustering | ❌ Single process |
| Keep-alive tuning | ❌ Defaults |
| Response streaming | ❌ n/a |

### 11.8 Assessment

**Performance is fine today and will degrade sharply and predictably.** The architecture is correct (no N+1, proper joins, good indexes on FKs); the problem is purely that nothing is bounded. The breaking point is roughly **1,000–2,000 attendance records** on `/admin/attendance`, which a single 30-student cohort reaches in ~50 sessions.

Pagination on the three overview endpoints is the single highest-leverage performance change and is a small piece of work.

---

## 12. CODE QUALITY

### 12.1 SOLID

| Principle | Assessment |
|---|---|
| **Single Responsibility** | 🟡 Good in `services/email/` (4 files, each with one clear job) and in the controllers. Violated in `techstack.routes.ts` / `batch.routes.ts`, which are simultaneously router, controller, service, and validator |
| **Open/Closed** | 🔴 Static classes with no interfaces. Adding a third email transport means editing `EmailService.dispatch`'s `if/else` chain; there is no `Mailer` interface for the two mailers to implement despite them having near-identical shapes |
| **Liskov** | n/a — no inheritance except `AppError extends Error` (correct) |
| **Interface Segregation** | 🟡 `EmailMessage` and `SendResult` in [types.ts](backend/src/services/email/types.ts) are well-designed, minimal, and transport-agnostic. Elsewhere, `any` is used where an interface belongs |
| **Dependency Inversion** | 🔴 Absent. `SessionService` imports `GoogleService` and `EmailService` as concrete modules. This is the direct cause of the service layer being untestable without live credentials |

### 12.2 Clean architecture

| Layer | Present | Comment |
|---|---|---|
| Routing | ✅ | Clean except the two fat routers |
| Controllers | ✅ | Genuinely thin — extract, delegate, respond |
| Services | ✅ | Where they exist |
| Repositories | ❌ | **Empty directory** — planned, abandoned |
| Domain models | ❌ | Prisma types used directly as the domain model |
| DTOs | ❌ | Prisma results serialised straight to JSON, so schema changes are API changes |

### 12.3 Naming & readability

**Strong.** `AppError`, `asyncHandler`, `restrictTo`, `logUnaffected`, `tripBreaker`, `probeEgress`, `classifySmtpError`, `isNetworkFailure` — these names say what they do. File and folder conventions are consistent (`*.service.ts`, `*.controller.ts`, `*.routes.ts`, `*.validator.ts`). Frontend components are consistently `PascalCase` with `{Domain}{Kind}` naming.

**Comment quality is genuinely unusual.** The email subsystem and `google.service.ts` explain *why*, not *what* — the nodemailer IPv6 workaround, the circuit-breaker rationale, why fallback is restricted to network failures, why two refresh tokens exist, why the guest list matters. Someone joining this codebase would understand those decisions immediately.

That makes the contrast sharper elsewhere: `techstack.routes.ts` and `batch.routes.ts` carry `// For MVP...` comments that document known shortcuts nobody came back to.

### 12.4 Type safety

| Area | Assessment |
|---|---|
| `tsc --noEmit` | ✅ **Both packages compile with zero errors** — verified |
| Backend strictness | ✅ `strict: true` |
| `req.user` | 🔴 Globally declared as `any` ([auth.middleware.ts:6-12](backend/src/middlewares/auth.middleware.ts#L6-L12)). Every `req.user.id` / `req.user.role` in the codebase is unchecked. This is exactly how the `/auth/me` shape bug (FEATURE_INVENTORY §6.1) went unnoticed |
| Service params | 🟡 Inline object literals rather than named interfaces; `status: any` and `level: any` in the attendance/progress services discard the Prisma enums |
| Frontend API types | 🔴 Only `Session`, `User`, `Batch`, `TechStack` are typed. Everything else is `(x: any)`. No shared API contract between packages |
| `server` variable | 🔴 `let server: any` ([server.ts:8](backend/src/server.ts#L8)) |

### 12.5 Duplication

| Duplication | Extent |
|---|---|
| `StudentsManagement.tsx` ↔ `InstructorsManagement.tsx` | ~95 % identical, 129 vs 128 lines. Differ only in a role string and three labels |
| Session creation dialogs | Two independent implementations (AdminDashboard inline vs `SessionFormDialog`) with different validation and different UX |
| Recipient-list assembly | Built three separate ways across `createSession`, `updateSession`, `cancelSession` |
| CRUD page scaffold | Query + 3 mutations + search + dialog state repeated near-verbatim across 5 admin pages |
| Startup-diagnostics banner formatting | Parallel implementations in `SmtpMailer` and `GmailApiMailer` |
| Health check endpoint | Defined twice with identical bodies |

### 12.6 Dead code

Fully catalogued in [FEATURE_INVENTORY.md §8](FEATURE_INVENTORY.md). Summary: 2 empty directories, 1 unused validator, 3 write-only DB columns, 1 unreachable enum value, 36 stale committed build artifacts, 6 ad-hoc scratch/verify scripts at the backend root (two of which **write to the live database and create real Calendar events**), 4 unused UI primitives, 1 unused 184-line stylesheet, 3 unused image assets, 2 stale Railway configs, and a fully-configured dark mode with zero implementation.

### 12.7 Technical debt register

| # | Debt | Cost to fix | Cost of delay |
|---|---|---|---|
| D1 | No migration history (git-ignored) | Medium | **Severe and compounding** — grows with every schema change |
| D2 | `validate()` discards parsed output | **Trivial** (2 lines) | High — silently negates all input sanitisation |
| D3 | No ownership authorization layer | Medium | High |
| D4 | No pagination | Medium | High — hard wall at ~2k records |
| D5 | `req.user` typed `any` | Small | Medium — actively hides bugs |
| D6 | No tests + `npm test` deliberately fails | Large | High — every change is unverified |
| D7 | Duplicated management pages | Small | Low |
| D8 | Two session-creation UIs | Small | Medium — divergent validation confuses users |
| D9 | Committed `dist/` | Trivial | Low |
| D10 | Scratch scripts at repo root | Trivial | Medium — `verify-*.ts` can pollute production data if run against prod env |
| D11 | Google hard-coupled to session creation | Small | Medium |
| D12 | No structured logging | Medium | High — blocks all diagnosis |
| D13 | Progress has no history table | Small **now**, impossible later | High — data is being lost every day |

### 12.8 Testing

| Aspect | Status |
|---|---|
| Backend unit tests | 2 files, ~40 lines total ([jwt.test.ts](backend/src/utils/jwt.test.ts), [AppError.test.ts](backend/src/utils/AppError.test.ts)) covering the two most trivial utilities |
| **`npm test`** | `echo "Error: no test specified" && exit 1` — **the existing tests cannot be run by the standard command and never run in CI** |
| Vitest config | None (`vitest.config.*` absent) |
| Integration tests | ❌ None |
| E2E tests | ❌ None — `verify-attendance.ts` / `verify-session-actions.ts` are manual scripts that mutate the real database |
| Frontend tests | ❌ None |
| Coverage | Effectively **0 %** of business logic |
| CI | ❌ No workflows |

Estimated coverage of *business* logic: **0 %**. Neither `SessionService`, `AttendanceService`, `ProgressService`, `UserService`, nor `AuthService` has a single test.

### 12.9 Code quality score

| Dimension | Weight | Score |
|---|---|---|
| Architecture & layering | 15 | 10 / 15 |
| SOLID / dependency management | 10 | 4 / 10 |
| Naming & readability | 10 | 9 / 10 |
| Comment & documentation quality | 10 | 8 / 10 |
| Type safety | 15 | 9 / 15 |
| Duplication | 10 | 5 / 10 |
| Dead code & hygiene | 10 | 4 / 10 |
| Testing | 20 | 1 / 20 |

### **CODE QUALITY SCORE: 50 / 100**

This number understates how pleasant most of this code is to read. The email subsystem alone would score in the high 80s. The aggregate is dragged down by two things: **near-zero test coverage** (−19 on its own) and **accumulated hygiene debt** (dead code, duplication, committed build output). Wiring `npm test` to vitest and adding service-layer tests would be the single largest score movement available.

---

## 13. SUMMARY OF FINDINGS BY SEVERITY

### Critical — fix before the next production schema change
1. **No migration history** — `backend/prisma/migrations/` is git-ignored. The production schema is unreproducible and unrollbackable.

### High — fix before onboarding real users at scale
2. `validate()` discards its parsed output, negating all input sanitisation globally (**2-line fix**).
3. No ownership authorization: instructors can mutate any session (Z1).
4. IDOR on student attendance and progress (Z2).
5. Batch roster + email PII exposed to all authenticated users (Z3).
6. Mass assignment on `PATCH /users/:id` can write a plaintext password (Z4/S1).
7. `GET /auth/me` omits `name`/`email`, breaking the UI on every page refresh.
8. No pagination on any list endpoint.
9. No structured logging or error tracking.
10. Effectively zero test coverage, and `npm test` is wired to fail.

### Medium
11. Google Calendar is a synchronous hard dependency of session creation.
12. Swallowed Calendar update/delete failures cause silent DB↔Google divergence.
13. No email retry or persistence — failed notifications are lost.
14. All email recipients share one `To:` header (cross-student PII).
15. Email dates are formatted in the server's timezone with no label.
16. `Session.instructorId` cascade delete is a latent data-loss bug.
17. Unauthenticated OAuth endpoints return a refresh token in the response body.
18. No login-specific rate limit; no lockout.
19. No React error boundary; several mutations fail silently in the UI.
20. `StudentProgress` overwrites rather than appending — history is being lost daily.

### Low
21. Dead code, duplication, committed `dist/`, scratch scripts, unused assets, stale Railway configs, unimplemented dark mode, unreachable `/admin/settings` route.
