# FEATURE INVENTORY

**Project:** Student Training Portal (repo folder: `Internship Portal`)
**Audit date:** 31 July 2026
**Audit basis:** Static reverse-engineering of the source tree at commit `2049678` plus two uncommitted working-tree changes (`backend/src/services/google.service.ts`, `backend/src/services/session.service.ts`).
**Method:** Every file under `backend/src`, `backend/prisma`, `frontend/src` was read. No code was executed against a live database. Type-checking was run read-only (`tsc --noEmit`) on both packages — **both pass with zero errors.**

> Where this document says a feature is missing, it means no implementing code was found. Where a conclusion could not be verified from source alone, it is labelled **UNVERIFIED**.

---

## 1. WHAT THIS PRODUCT IS

A three-role training/cohort management portal. An admin creates tech stacks, groups students into batches, assigns instructors, and schedules live classes. Scheduling a class provisions a real Google Calendar event with a Google Meet link and emails every participant. Instructors mark attendance and rate per-tech-stack progress. Students see their classes, attendance percentage, and progress bars.

It is a working MVP with an unusually mature email subsystem bolted onto an otherwise conventional and in places under-secured CRUD application.

---

## 2. TECH STACK

### Backend — `backend/`
| Concern | Choice | Evidence |
|---|---|---|
| Runtime | Node.js, CommonJS | [package.json](backend/package.json) `"type": "commonjs"` |
| Framework | Express 4.22 | [app.ts](backend/src/app.ts) |
| Language | TypeScript 5.9, `strict: true` | [tsconfig.json](backend/tsconfig.json) |
| ORM | Prisma 7.9 + `@prisma/adapter-pg` driver adapter | [db.ts](backend/src/config/db.ts#L1-L11) |
| Database | PostgreSQL (Supabase; pgBouncer pooled + direct URL) | [.env.example](backend/.env.example) |
| Auth | `jsonwebtoken` HS256, bcrypt cost 10 | [jwt.ts](backend/src/utils/jwt.ts), [auth.service.ts](backend/src/services/auth.service.ts#L16) |
| Validation | Zod 3.25 | [validators/](backend/src/validators/) |
| Google APIs | `googleapis` 173 (Calendar v3, Gmail v1) | [google.service.ts](backend/src/services/google.service.ts), [GmailApiMailer.ts](backend/src/services/email/GmailApiMailer.ts) |
| Email | Nodemailer 9 (SMTP) **and** Gmail REST API | [services/email/](backend/src/services/email/) |
| Security mw | helmet, cors, express-rate-limit, 10 kB body cap | [app.ts](backend/src/app.ts#L17-L40) |
| Logging | `morgan` + 168 raw `console.*` calls | — |
| Test runner | vitest (installed, **not wired to `npm test`**) | [package.json](backend/package.json#L11) |

### Frontend — `frontend/`
| Concern | Choice | Evidence |
|---|---|---|
| Framework | React 19 + Vite 8 | [package.json](frontend/package.json) |
| Language | TypeScript ~6.0 | [tsconfig.app.json](frontend/tsconfig.app.json) |
| Routing | react-router-dom 7, lazy-loaded routes | [AppRoutes.tsx](frontend/src/routes/AppRoutes.tsx) |
| Server state | TanStack Query 5 | [App.tsx](frontend/src/App.tsx#L6) |
| Forms | react-hook-form + zod resolver | [SessionFormDialog.tsx](frontend/src/components/sessions/SessionFormDialog.tsx) |
| UI kit | shadcn/ui over Radix + Tailwind 3.4 | [components/ui/](frontend/src/components/ui/) |
| HTTP | axios with request/response interceptors | [api.ts](frontend/src/services/api.ts) |
| Lint | oxlint | [.oxlintrc.json](frontend/.oxlintrc.json) |
| Tests | **none** | — |

### Deployment targets
Render (backend, `/api/health` healthcheck), Vercel (frontend SPA rewrite), Supabase (Postgres). Stale Railway configs also present ([railway.json](backend/railway.json), [railway.toml](backend/railway.toml) — the latter healthchecks `/api/users`, an authenticated route that would always fail).

---

## 3. FOLDER STRUCTURE

```
backend/src/
├── app.ts               Express app, middleware chain
├── server.ts            Boot, DB connect, graceful shutdown, email diagnostics
├── config/{db,env}.ts   Prisma client; required-env fail-fast
├── routes/              8 routers (2 contain inline business logic)
├── controllers/         5 thin controllers
├── services/            7 static-class services + email/ subpackage
│   └── email/           SmtpMailer, GmailApiMailer, smtpDiagnostics, types
├── middlewares/         auth, error, validate
├── validators/          5 Zod schema modules
├── utils/               AppError, asyncHandler, jwt (+2 vitest specs)
├── repositories/        EMPTY — dead scaffolding
└── types/               EMPTY — dead scaffolding

frontend/src/
├── routes/AppRoutes.tsx
├── layouts/DashboardLayout.tsx   Route guard + chrome
├── contexts/AuthContext.tsx
├── services/api.ts
├── pages/                        11 pages + 7 admin pages
└── components/
    ├── ui/                       21 shadcn primitives
    └── {sessions,users,batches,tech-stacks,attendance,progress}/
```

---

## 4. FEATURE INVENTORY TABLE

Legend — **Status:** ✅ Complete · 🟡 Partial · 🔴 Stub/Placeholder · ⛔ Not implemented
**Prod ready:** Yes / Yes\* (works, has caveats listed in Notes) / No

### 4.1 Authentication & Identity

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Email/password login | Auth | ✅ | 100 | Yes | [auth.service.ts](backend/src/services/auth.service.ts), [Login.tsx](frontend/src/pages/Login.tsx) | bcrypt, JWT | Constant-time-ish generic error message; inactive users rejected |
| 2 | JWT issuance (HS256, 1d) | Auth | ✅ | 100 | Yes\* | [jwt.ts](backend/src/utils/jwt.ts) | `JWT_SECRET` | Fail-fast on missing secret. No `iss`/`aud`/`jti` claims |
| 3 | Bearer-token middleware | Auth | ✅ | 100 | Yes | [auth.middleware.ts](backend/src/middlewares/auth.middleware.ts#L14-L47) | Prisma | Re-reads user on **every** request — deactivation is instant, but adds 1 query/request |
| 4 | `GET /auth/me` session restore | Auth | 🟡 | 50 | **No** | [auth.controller.ts:24](backend/src/controllers/auth.controller.ts#L24-L29) | — | **BUG — see §6.1.** Returns only `{id, role, status}`; the UI needs `name`/`email` |
| 5 | Logout | Auth | 🟡 | 40 | Yes\* | [auth.controller.ts:15](backend/src/controllers/auth.controller.ts#L15-L22) | — | Server-side no-op; client deletes localStorage. Stolen tokens stay valid to expiry |
| 6 | Refresh tokens | Auth | ⛔ | 0 | — | — | — | No implementation anywhere. Session dies hard at 24 h |
| 7 | Password reset / forgot password | Auth | ⛔ | 0 | — | — | — | No route, no token model, no email template |
| 8 | Email verification | Auth | ⛔ | 0 | — | — | — | No `emailVerified` column |
| 9 | MFA / SSO | Auth | ⛔ | 0 | — | — | — | Google OAuth exists only for Calendar/Gmail, not for user login |
| 10 | Self-service registration | Auth | ⛔ | 0 | — | — | — | Deliberate: accounts are admin-provisioned only |

### 4.2 Authorization

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 11 | Role gates (`restrictTo`) | Authz | ✅ | 100 | Yes | [auth.middleware.ts:49](backend/src/middlewares/auth.middleware.ts#L49-L56) | — | Coarse-grained but correct and consistently applied |
| 12 | Frontend route guard | Authz | ✅ | 95 | Yes | [DashboardLayout.tsx](frontend/src/layouts/DashboardLayout.tsx#L7-L21) | AuthContext | Correct redirect to `/login` and `/unauthorized` |
| 13 | Role-scoped list queries | Authz | 🟡 | 70 | Yes\* | [batch.routes.ts:12-19](backend/src/routes/batch.routes.ts#L12-L19), [session.controller.ts:17-26](backend/src/controllers/session.controller.ts#L17-L26) | — | Works for `GET /batches` and `GET /sessions`. Not applied elsewhere |
| 14 | Resource **ownership** checks | Authz | ⛔ | 0 | **No** | — | — | **GAP — see §6.2.** Any instructor may edit/cancel/delete *any* session |
| 15 | Per-record read scoping | Authz | ⛔ | 0 | **No** | — | — | **GAP — see §6.3.** Students can read any other student's attendance & progress |
| 16 | SUPER_ADMIN role | Authz | ⛔ | 0 | — | [schema.prisma:9-13](backend/prisma/schema.prisma#L9-L13) | — | Enum is `ADMIN \| INSTRUCTOR \| STUDENT`. The seed calls the admin "Super Admin" but it is a plain `ADMIN` |
| 17 | Permission/role management UI | Authz | ⛔ | 0 | — | — | — | Role is fixed at creation from which admin page you used |

### 4.3 User Management

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 18 | Create student | Users | ✅ | 95 | Yes | [StudentsManagement.tsx](frontend/src/pages/admin/StudentsManagement.tsx), [user.service.ts:7](backend/src/services/user.service.ts#L7-L34) | bcrypt | Admin types a temp password by hand; no welcome email, no forced rotation |
| 19 | Create instructor | Users | ✅ | 95 | Yes | [InstructorsManagement.tsx](frontend/src/pages/admin/InstructorsManagement.tsx) | — | Same page component pattern, duplicated verbatim (see §6.7) |
| 20 | Create admin | Users | 🟡 | 30 | Yes\* | [user.validator.ts:8](backend/src/validators/user.validator.ts#L8-L10) | — | API accepts `role: 'ADMIN'`; **no UI page exists**. Only path is the seed script or a raw API call |
| 21 | Edit user (name/email) | Users | 🟡 | 70 | **No** | [UserFormDialog.tsx](frontend/src/components/users/UserFormDialog.tsx#L71) | — | The UI sends `email`, which the validator does not allow — it only works because of the mass-assignment hole (§6.4) |
| 22 | Activate / deactivate user | Users | ✅ | 100 | Yes | [UserTable.tsx:89](frontend/src/components/users/UserTable.tsx#L89-L104) | — | Enforced at auth time (403 "account has been deactivated") |
| 23 | Delete user | Users | ⛔ | 0 | — | — | — | No endpoint. Deactivation is the only off-ramp (arguably correct) |
| 24 | Own-profile edit (name, password) | Users | ✅ | 90 | Yes\* | [ProfilePage.tsx](frontend/src/pages/ProfilePage.tsx), [user.service.ts:96](backend/src/services/user.service.ts#L96-L122) | bcrypt | Correctly re-hashes. No "current password" confirmation step |
| 25 | User search | Users | 🟡 | 40 | Yes\* | [StudentsManagement.tsx:79](frontend/src/pages/admin/StudentsManagement.tsx#L79-L82) | — | Client-side `.filter()` over the full downloaded list. Breaks at scale |
| 26 | User pagination | Users | ⛔ | 0 | **No** | — | — | `GET /users` returns **every** user, unbounded |
| 27 | Bulk import (CSV) | Users | ⛔ | 0 | — | — | — | Not present |

### 4.4 Curriculum Structure

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 28 | Tech stack CRUD | Curriculum | ✅ | 95 | Yes\* | [techstack.routes.ts](backend/src/routes/techstack.routes.ts) | — | Business logic lives inline in the router. Hand-rolled `if (!name)` instead of Zod |
| 29 | FK-safe tech stack delete | Curriculum | ✅ | 100 | Yes | [techstack.routes.ts:45-52](backend/src/routes/techstack.routes.ts#L45-L52) | — | Catches Prisma `P2003` and returns a human message. Good |
| 30 | Batch CRUD | Curriculum | ✅ | 90 | Yes\* | [batch.routes.ts](backend/src/routes/batch.routes.ts) | — | Also inline in the router, also no Zod |
| 31 | Assign students to batch | Curriculum | 🟡 | 85 | Yes\* | [batch.routes.ts:70-82](backend/src/routes/batch.routes.ts#L70-L82) | Prisma `$transaction` | Delete-all-then-recreate inside a transaction — correct but destroys any future join metadata. `studentIds.map` throws a 500 if the body is not an array |
| 32 | Assign instructors to batch | Curriculum | 🟡 | 85 | Yes\* | [batch.routes.ts:85-97](backend/src/routes/batch.routes.ts#L85-L97) | — | Same pattern, same caveat |
| 33 | Batch capacity / dates / status | Curriculum | ⛔ | 0 | — | [schema.prisma:45](backend/prisma/schema.prisma#L45-L56) | — | `Batch` has only `name` + `techStackId`. No start/end date, no lifecycle, no timestamps |

### 4.5 Scheduling & Google

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 34 | Create session + Meet link | Scheduling | ✅ | 90 | Yes\* | [session.service.ts:7-126](backend/src/services/session.service.ts#L7-L126) | Calendar API | Well-instrumented with per-step timings. **Hard dependency**: a Google failure aborts the whole creation (§6.5) |
| 35 | Calendar guest list | Google | ✅ | 95 | Yes | [google.service.ts:92-107](backend/src/services/google.service.ts#L92-L107) | Calendar API | *Uncommitted change.* Adds instructor + all batch students as attendees so nobody has to knock. `guestsCanSeeOtherGuests: false` prevents roster leakage |
| 36 | Edit session (title/desc/time) | Scheduling | 🟡 | 80 | Yes\* | [session.service.ts:140-222](backend/src/services/session.service.ts#L140-L222) | Calendar API | **No request-body validation on this route.** Calendar patch failure is logged and swallowed → DB and Calendar can silently diverge |
| 37 | Cancel session | Scheduling | ✅ | 85 | Yes\* | [session.service.ts:224-265](backend/src/services/session.service.ts#L224-L265) | Calendar API | Sets `CANCELLED`, deletes the Calendar event, emails everyone. Google deletion happens *after* the DB write and can fail silently |
| 38 | Delete session | Scheduling | 🟡 | 40 | Yes\* | [session.service.ts:267-277](backend/src/services/session.service.ts#L267-L277) | — | Endpoint works; **no UI exposes it**. Cascade-deletes all attendance for that session |
| 39 | Mark session COMPLETED | Scheduling | ⛔ | 0 | **No** | — | — | **DEAD PATH.** The enum value and both frontend badges exist, but no code ever writes `COMPLETED`. Requires a scheduled job that does not exist |
| 40 | Recurring sessions | Scheduling | ⛔ | 0 | — | — | — | No RRULE handling |
| 41 | Conflict / double-booking detection | Scheduling | ⛔ | 0 | **No** | — | — | An instructor can be booked into two overlapping sessions with no warning |
| 42 | Past-date guard | Scheduling | ⛔ | 0 | **No** | [session.validator.ts:9](backend/src/validators/session.validator.ts#L9-L11) | — | Validator checks parseability only. Sessions can be scheduled in the past |
| 43 | Calendar (month/week) view | Scheduling | 🔴 | 0 | **No** | [AppRoutes.tsx:46](frontend/src/routes/AppRoutes.tsx#L46) | — | `/admin/calendar` renders `PlaceholderPage`. `components/ui/calendar.tsx` is installed and unused |
| 44 | Google OAuth bootstrap flow | Google | 🟡 | 70 | **No** | [google.routes.ts](backend/src/routes/google.routes.ts) | — | Works, but is **unauthenticated** and prints the refresh token as JSON (§6.6). Token is then pasted into env by hand |
| 45 | Per-instructor Google identity | Google | ⛔ | 0 | — | [docs/google-meet-cohost-feasibility.md §8b](docs/google-meet-cohost-feasibility.md) | — | Deliberately not built; documented as option "8b" |
| 46 | Meet co-host / recording | Google | ⛔ | 0 | — | [docs/google-meet-cohost-feasibility.md](docs/google-meet-cohost-feasibility.md) | — | **Proven impossible** on a free Gmail organizer account. Excellent evidence-based writeup; do not re-litigate |
| 47 | Google API mock mode | DevEx | ✅ | 100 | Yes | [google.service.ts:78-87](backend/src/services/google.service.ts#L78-L87) | — | Absent `GOOGLE_REFRESH_TOKEN`, returns fake `meet.google.com/mock-…` links so local dev works offline |

### 4.6 Email

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 48 | Dual-transport dispatch (SMTP → Gmail API) | Email | ✅ | 95 | Yes | [email.service.ts:45-75](backend/src/services/email.service.ts#L45-L75) | nodemailer, googleapis | **The best-engineered subsystem in the repo.** Falls back *only* on network-class failures, deliberately not on auth/TLS errors |
| 49 | SMTP transport | Email | ✅ | 95 | Yes | [SmtpMailer.ts](backend/src/services/email/SmtpMailer.ts) | nodemailer | Pins IPv4 (nodemailer 9 ignores `family`), forces STARTTLS on 587, TLS ≥ 1.2 |
| 50 | SMTP circuit breaker | Email | ✅ | 100 | Yes | [SmtpMailer.ts:84-104](backend/src/services/email/SmtpMailer.ts#L84-L104) | — | 10-min cooldown after a connection-level failure so sends fail fast instead of parking sockets |
| 51 | Gmail API transport | Email | ✅ | 95 | Yes | [GmailApiMailer.ts](backend/src/services/email/GmailApiMailer.ts) | googleapis | Least-privilege `gmail.send` scope on a **separate** refresh token from Calendar. RFC 2047 subject encoding |
| 52 | Failure classification | Email | ✅ | 100 | Yes | [smtpDiagnostics.ts:115-231](backend/src/services/email/smtpDiagnostics.ts#L115-L231) | — | Maps errors to DNS/AUTH/TLS/TIMEOUT/UNREACHABLE/REJECTED with a "what to check" line each |
| 53 | Startup diagnostics + TCP egress probe | Email | ✅ | 100 | Yes | [SmtpMailer.ts:276-386](backend/src/services/email/SmtpMailer.ts#L276-L386) | — | Proves at boot whether the *platform* blocks SMTP vs. the app misconfigured. Non-blocking |
| 54 | Refresh-token setup CLI | Email | ✅ | 100 | Yes | [scripts/gmail-auth-url.ts](backend/scripts/gmail-auth-url.ts) | — | `npm run gmail:auth`. Clear step-by-step operator output |
| 55 | Session-created / updated / cancelled emails | Email | ✅ | 90 | Yes | [email.service.ts:84-204](backend/src/services/email.service.ts#L84-L204) | — | Three templates. Every send is fire-and-forget and can never fail a request |
| 56 | HTML email templates | Email | ⛔ | 0 | **No** | — | — | Plaintext only. No branding, no calendar `.ics`, no unsubscribe |
| 57 | Email retry / queue / outbox | Email | ⛔ | 0 | **No** | — | — | **One attempt per message.** A failed notification is logged and permanently lost — no persistence, no dead-letter |
| 58 | Per-recipient delivery | Email | 🟡 | 50 | Yes\* | [SmtpMailer.ts:223](backend/src/services/email/SmtpMailer.ts#L223) | — | All recipients on one `To:` header — **every student sees every other student's email address** |
| 59 | Reminder emails (T-24h / T-15m) | Email | ⛔ | 0 | — | — | — | Requires a scheduler; none exists |

### 4.7 Attendance

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 60 | Mark attendance (4 states) | Attendance | ✅ | 90 | Yes\* | [attendance.service.ts:6-51](backend/src/services/attendance.service.ts#L6-L51) | — | Idempotent `upsert` on `(sessionId, studentId)`. Rejects cancelled sessions. **Does not verify the student is enrolled in that batch** |
| 61 | Roster dialog + bulk mark | Attendance | ✅ | 85 | Yes\* | [AttendanceFormDialog.tsx](frontend/src/components/attendance/AttendanceFormDialog.tsx) | — | "Mark All Present/Absent". Saves via **N parallel POSTs** (`Promise.all`) — partial failure leaves partial state (§6.8) |
| 62 | Admin attendance overview | Attendance | 🟡 | 75 | **No** | [AdminAttendance.tsx](frontend/src/pages/admin/AdminAttendance.tsx), [attendance.service.ts:88](backend/src/services/attendance.service.ts#L88-L98) | — | Fetches **every attendance row ever** and aggregates in the browser. No filters, no date range, no pagination |
| 63 | Student attendance % | Attendance | ✅ | 80 | Yes | [StudentDashboard.tsx:41-44](frontend/src/pages/StudentDashboard.tsx#L41-L44) | — | Computed client-side as present/total |
| 64 | Instructor attendance page | Attendance | ✅ | 85 | Yes | [InstructorAttendance.tsx](frontend/src/pages/InstructorAttendance.tsx) | — | Lists own non-cancelled sessions → roster dialog |
| 65 | "Who marked this" audit | Attendance | 🟡 | 30 | **No** | [schema.prisma:119](backend/prisma/schema.prisma#L119) | — | `markedBy` is written but **never read or displayed**, and has no FK to `User` |
| 66 | Attendance export / report | Attendance | ⛔ | 0 | — | — | — | Not present |

### 4.8 Progress

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 67 | Update progress (0-100 + level) | Progress | ✅ | 90 | Yes\* | [progress.service.ts:5-36](backend/src/services/progress.service.ts#L5-L36) | — | `upsert` on `(studentId, techStackId)`. No check the student belongs to the instructor |
| 68 | Slider dialog with auto-level | Progress | ✅ | 90 | Yes | [ProgressSliderDialog.tsx:33-38](frontend/src/components/progress/ProgressSliderDialog.tsx#L33-L38) | — | <40 Beginner, <80 Intermediate, else Advanced. Nice touch |
| 69 | Instructor notes | Progress | ✅ | 90 | Yes | [ProgressSliderDialog.tsx:99](frontend/src/components/progress/ProgressSliderDialog.tsx#L99-L105) | — | Free text, surfaced to the student on their dashboard |
| 70 | Admin progress overview | Progress | 🟡 | 75 | **No** | [AdminProgress.tsx](frontend/src/pages/admin/AdminProgress.tsx) | — | Same unbounded-fetch pattern as attendance. Has a useful "At Risk (<50%)" tile |
| 71 | Instructor progress page | Progress | 🟡 | 70 | **No** | [InstructorProgress.tsx:41-44](frontend/src/pages/InstructorProgress.tsx#L41-L44) | — | Calls the **global** `/progress/overview` — an instructor downloads every student's progress in the system, then filters client-side |
| 72 | Progress history / trend | Progress | ⛔ | 0 | — | [schema.prisma:137](backend/prisma/schema.prisma#L137-L152) | — | Only `lastUpdated`. Each write overwrites the prior value — no time series |

### 4.9 Dashboards & Shell

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 73 | Admin dashboard | UI | 🟡 | 60 | Yes\* | [AdminDashboard.tsx](frontend/src/pages/AdminDashboard.tsx) | — | 4 count tiles + session table + an **older, cruder** schedule dialog than the one in Sessions (§6.7). Uses raw `alert()` |
| 74 | Instructor dashboard | UI | ✅ | 75 | Yes | [InstructorDashboard.tsx](frontend/src/pages/InstructorDashboard.tsx) | — | Sessions, batches, derived student list. Good empty states |
| 75 | Student dashboard | UI | ✅ | 75 | Yes | [StudentDashboard.tsx](frontend/src/pages/StudentDashboard.tsx) | — | Attendance %, upcoming classes, progress bars |
| 76 | Collapsible role-aware sidebar | UI | ✅ | 95 | Yes | [AppSidebar.tsx](frontend/src/components/AppSidebar.tsx) | shadcn sidebar | Mobile sheet variant via `use-mobile` |
| 77 | 404 / 403 pages | UI | ✅ | 100 | Yes | [NotFoundPage.tsx](frontend/src/pages/NotFoundPage.tsx), [UnauthorizedPage.tsx](frontend/src/pages/UnauthorizedPage.tsx) | — | — |
| 78 | Route code-splitting | Perf | ✅ | 100 | Yes | [AppRoutes.tsx](frontend/src/routes/AppRoutes.tsx) | — | All 17 pages lazy-loaded behind a `Suspense` |
| 79 | Settings page | UI | 🔴 | 0 | **No** | [AppRoutes.tsx:47](frontend/src/routes/AppRoutes.tsx#L47) | — | `/admin/settings` renders a placeholder **and is unreachable** — the sidebar's "Settings" points at `/profile` |
| 80 | Toast/notification system | UI | ⛔ | 0 | **No** | — | — | Feedback is `alert()`, inline red divs, or nothing |
| 81 | React error boundary | UI | ⛔ | 0 | **No** | — | — | Despite `DEPLOYMENT_CHECKLIST.md` claiming one. Any render throw blanks the app |
| 82 | Dark mode | UI | ⛔ | 0 | — | [tailwind.config.js:4](frontend/tailwind.config.js#L4) | — | `darkMode: ["class"]` configured, CSS vars defined, **zero `dark:` classes** and no toggle |

### 4.10 Platform / Ops

| # | Feature | Category | Status | % | Prod ready | Files | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| 83 | Health check | Ops | ✅ | 100 | Yes | [app.ts:46-63](backend/src/app.ts#L46-L63) | — | `/api/health` and `/health`, both with uptime |
| 84 | Graceful shutdown | Ops | ✅ | 100 | Yes | [server.ts:34-50](backend/src/server.ts#L34-L50) | — | SIGTERM/SIGINT → close server → disconnect Prisma |
| 85 | Env fail-fast | Ops | ✅ | 100 | Yes | [env.ts](backend/src/config/env.ts) | — | Exits on missing required vars; warns (not fails) on missing email vars. Correct split |
| 86 | Global error handler | Ops | ✅ | 85 | Yes | [error.middleware.ts](backend/src/middlewares/error.middleware.ts) | — | Zod / AppError / Prisma / unknown, with prod message redaction |
| 87 | Rate limiting | Sec | 🟡 | 60 | Yes\* | [app.ts:26-31](backend/src/app.ts#L26-L31) | — | One global 100/15 min bucket across all `/api`, **including `/api/health`**. No stricter bucket on login |
| 88 | Helmet / CORS / compression | Sec | 🟡 | 80 | Yes\* | [app.ts:17-39](backend/src/app.ts#L17-L39) | — | CORS falls back to `origin: '*'` with `credentials: true` if `CORS_ORIGIN` is unset |
| 89 | DB migrations | Ops | ⛔ | 0 | **No** | [.gitignore:34](.gitignore#L34) | — | **`backend/prisma/migrations/` is git-ignored.** Zero migration history. Schema is applied with `db push` — no reproducible, reviewable, rollback-able schema evolution |
| 90 | Seed script | Ops | ✅ | 90 | Yes\* | [seed.ts](backend/prisma/seed.ts) | — | Idempotent. Creates `admin@example.com` / `admin123` — **must not reach production unchanged** |
| 91 | Structured logging | Ops | ⛔ | 0 | **No** | — | — | 168 `console.*` calls, no levels, no request IDs, no JSON |
| 92 | APM / error tracking | Ops | ⛔ | 0 | **No** | — | — | No Sentry/Datadog/OTel |
| 93 | Automated tests | QA | 🔴 | 5 | **No** | [jwt.test.ts](backend/src/utils/jwt.test.ts), [AppError.test.ts](backend/src/utils/AppError.test.ts) | vitest | 2 trivial unit specs. **`npm test` is literally `echo "Error: no test specified" && exit 1`** — they never run in CI |
| 94 | CI/CD pipeline | Ops | ⛔ | 0 | **No** | — | — | No `.github/workflows` |
| 95 | API documentation | DevEx | ⛔ | 0 | — | — | — | No OpenAPI/Swagger |
| 96 | Audit log | Compliance | ⛔ | 0 | **No** | — | — | No record of who changed what, anywhere |
| 97 | File upload / resources | Content | ⛔ | 0 | — | — | — | No storage integration of any kind |
| 98 | In-app notifications | Comms | ⛔ | 0 | — | — | — | Email only |
| 99 | Reporting / CSV export | Analytics | ⛔ | 0 | — | — | — | Not present |
| 100 | Assignments / certificates / feedback | LMS | ⛔ | 0 | — | — | — | Out of current scope entirely |

**Totals:** 100 tracked capabilities — **38 complete**, **21 partial**, **3 placeholder**, **38 not implemented**.

---

## 5. USER FLOWS

### 5.1 Roles that exist
Exactly three: `ADMIN`, `INSTRUCTOR`, `STUDENT` ([schema.prisma:9-13](backend/prisma/schema.prisma#L9-L13)). **There is no Super Admin role** despite the seed naming the first user "Super Admin" — it is a plain `ADMIN`. There is no instructor-vs-lead-instructor distinction and no read-only/observer role.

### 5.2 Authentication flow (all roles)

```
POST /api/auth/login {email, password}
        ↓  AuthService.login — findUnique(email) → reject if !user || !user.status
        ↓  bcrypt.compare  → reject on mismatch (same generic 401 either way)
        ↓  generateToken({id, role}), 1d expiry
   200 { user:{id,name,email,role}, token }
        ↓  AuthContext.login() → localStorage['token'] = token; setUser(user)
        ↓  role switch → /admin | /instructor | /student

── on every subsequent request ──
  axios interceptor attaches  Authorization: Bearer <token>
        ↓  authenticate() verifies JWT, re-reads user from DB, checks status
        ↓  401 anywhere → interceptor wipes localStorage → window.location = '/login'

── on browser refresh ──
  AuthContext.initAuth → GET /api/auth/me
        ↓  returns ONLY {id, role, status}    ← ⚠ name and email are lost (§6.1)
```

### 5.3 Admin — schedule a class (the core money path)

```
Login → /admin → sidebar "Sessions" → /admin/sessions
   ↓ "Schedule Session" → SessionFormDialog (zod-validated client-side)
   ↓ POST /api/sessions {title, description?, batchId, instructorId, startTime, durationMinutes}
   ↓ restrictTo(ADMIN, INSTRUCTOR) → validate(createSessionSchema)
   ↓
SessionService.createSession
   ├─ 1. Promise.all([ find batch + students , find instructor ])   → 404 if either missing
   ├─ 2. endTime = startTime + durationMinutes
   ├─ 3. Build guest list = instructor.email + every student email in the batch
   ├─ 4. GoogleService.createMeetEvent(...)  ── 10 s timeout race
   │        └─ Calendar events.insert, conferenceDataVersion=1, sendUpdates:'none'
   │        └─ ❌ on failure → AppError 500, NOTHING is persisted, whole request fails
   ├─ 5. prisma.session.create({..., googleMeetLink, googleEventId, meetingCode})
   └─ 6. void EmailService.sendSessionNotification(...)   ← fire-and-forget, never awaited
              └─ dispatch: SMTP → (network failure only) → Gmail API → log outcome
   ↓
201 { session }  → React Query invalidates ['sessions'] → table re-renders
   ↓
Students/instructor: receive email AND (if on Google accounts) the event on their calendar,
and can join the Meet directly without knocking because they are on the guest list.
```

### 5.4 Admin — remaining flows

```
/admin                → 4 count tiles + all-sessions table (+ a second, older schedule dialog)
/admin/students       → list · search · add · edit · activate/deactivate
/admin/instructors    → identical page, different role filter
/admin/tech-stacks    → list · search · add · edit · delete (FK-protected)
/admin/batches        → CRUD + "Assign Students" / "Assign Instructors" checkbox dialogs
/admin/sessions       → table · search · view · edit · cancel   (delete exists in API only)
/admin/attendance     → global stats tiles + every attendance row ever recorded
/admin/progress       → avg %, at-risk count, advanced count + every progress row
/admin/calendar       → 🔴 PlaceholderPage
/admin/settings       → 🔴 PlaceholderPage, and unreachable from the sidebar
/profile              → change own name / password
```

### 5.5 Instructor

```
Login → /instructor
   ├─ My Upcoming Sessions   (GET /sessions auto-filtered to instructorId server-side)
   ├─ My Assigned Batches    (GET /batches auto-filtered via instructorBatches)
   ├─ My Students            (derived client-side from the batches payload)
   └─ "Schedule Session"     → SessionFormDialog, instructor dropdown locked to self
                               ⚠ but the API would accept any instructorId

/instructor/attendance → pick a session → roster dialog → radio per student
                          → N parallel POST /api/attendance → upsert each
/instructor/progress   → pick student + tech stack → slider dialog
                          → POST /api/progress (upsert)
                          ⚠ the page sources data from the GLOBAL /progress/overview
/profile               → change own name / password

NOT AVAILABLE to instructors in the UI: editing or cancelling their own sessions.
(The API permits it; no screen calls it.)
```

### 5.6 Student

```
Login → /student
   ├─ Attendance %  (GET /attendance/student/:ownId, computed in-browser)
   ├─ Upcoming Classes with "Join Meeting" (GET /sessions, filtered to own batches)
   └─ Learning Progress bars + instructor notes (GET /progress/student/:ownId)
/profile → change own name / password

Students have NO way to: see a class roster, see their own attendance history in detail,
export anything, submit feedback, or contact an instructor.
```

### 5.7 Operator (out-of-band, no role)

```
npm run gmail:auth                  → prints a consent URL for the gmail.send scope
GET /api/google/auth                → redirects to Google consent (Calendar scope)
GET /api/google/oauth/callback?code → exchanges the code, returns tokens AS JSON
                                      ⚠ neither route requires authentication (§6.6)
operator copies refresh_token → env → restart → startup banner confirms reachability
```

---

## 6. NOTABLE FINDINGS REFERENCED ABOVE

### 6.1 `GET /auth/me` drops `name` and `email` — user-visible on every refresh
[auth.middleware.ts:29-32](backend/src/middlewares/auth.middleware.ts#L29-L32) selects `{id, role, status}`. [auth.controller.ts:24](backend/src/controllers/auth.controller.ts#L24-L29) returns `req.user` verbatim. [AuthContext.tsx:30](frontend/src/contexts/AuthContext.tsx#L30) assigns that straight into `User` (typed `{id,name,email,role}`).

**Consequence:** login populates the name correctly, but after any page refresh the header renders `Hello, undefined` ([DashboardLayout.tsx:32](frontend/src/layouts/DashboardLayout.tsx#L32)) and the Profile page shows blank Email and Name fields ([ProfilePage.tsx:34-36](frontend/src/pages/ProfilePage.tsx#L34-L36)). Routing still works because `role` survives. **UNVERIFIED at runtime** — inferred from source; trivially confirmable in a browser.

### 6.2 No ownership check on session mutation
[session.routes.ts:29-36](backend/src/routes/session.routes.ts#L29-L36) gates `PATCH /:id`, `PATCH /:id/cancel` and `DELETE /:id` on role alone. `SessionService` never compares `session.instructorId` to `req.user.id`. Any instructor with any session ID can retime, cancel or delete another instructor's class — which also fires cancellation emails to that other cohort. The code comments acknowledge this: *"For MVP, restricting to ADMIN and INSTRUCTOR is sufficient."*

### 6.3 IDOR on student-scoped reads
[attendance.routes.ts:18](backend/src/routes/attendance.routes.ts#L18) and [progress.routes.ts:16](backend/src/routes/progress.routes.ts#L16) are registered **before** `restrictTo`, so any authenticated user — including a student — can pass any `:studentId` and read that person's full attendance and progress record, including instructor notes about them.

### 6.4 Mass assignment on `PATCH /users/:id`
[validate.middleware.ts:7-11](backend/src/middlewares/validate.middleware.ts#L7-L11) parses a *copy* of the request and discards the result; `req.body` is never replaced with the parsed output. [user.controller.ts:31](backend/src/controllers/user.controller.ts#L31) then passes raw `req.body` into `prisma.user.update({ data })` typed as `Prisma.UserUpdateInput`.

Any Prisma-writable `User` field therefore passes through regardless of the Zod schema. The sharpest case: `PATCH /api/users/:id {"password":"x"}` writes an **unhashed** password, permanently locking that user out because `bcrypt.compare` will never match. Requires ADMIN, so this is a privilege-limited integrity bug rather than a privilege escalation — but note that the Edit User dialog **depends** on this hole to change emails at all ([UserFormDialog.tsx:71](frontend/src/components/users/UserFormDialog.tsx#L71)), so closing it without also widening `updateUserSchema` will silently break email editing.

### 6.5 Google is a hard dependency of session creation
[session.service.ts:75-79](backend/src/services/session.service.ts#L75-L79) rethrows any Calendar failure as a 500 *before* the DB insert. A Google outage, an expired refresh token, or a >10 s API response means **no class can be scheduled at all** — not even without a link. Contrast this with the email path, which is deliberately isolated. The asymmetry looks unintentional.

### 6.6 Unauthenticated OAuth bootstrap endpoints
[google.routes.ts](backend/src/routes/google.routes.ts) mounts `/api/google/auth` and `/api/google/oauth/callback` with **no `authenticate` middleware**, and the callback returns the full token set — including `refresh_token` — as a plaintext JSON body. These are operator-only setup endpoints and should not be publicly reachable in production.

### 6.7 Two divergent session-creation UIs
[AdminDashboard.tsx:107-151](frontend/src/pages/AdminDashboard.tsx#L107-L151) contains a hand-rolled dialog with native `<select>`s, split date/time inputs, no description field and `alert()` feedback. [SessionFormDialog.tsx](frontend/src/components/sessions/SessionFormDialog.tsx) is the maintained version: Radix selects, `datetime-local`, zod validation, inline errors. Both are live. Similarly, `StudentsManagement.tsx` and `InstructorsManagement.tsx` are ~95 % identical files differing only in a role string.

### 6.8 Attendance saving is not atomic
[AttendanceFormDialog.tsx:50-54](frontend/src/components/attendance/AttendanceFormDialog.tsx#L50-L54) issues one `POST /api/attendance` per student via `Promise.all`. A 30-student batch is 30 concurrent requests; if the rate limiter (100/15 min) or the network trips partway, some students are saved and some are not, and the UI reports a single failure with no indication of which. There is no bulk endpoint.

---

## 7. FEATURE GAP ANALYSIS

Capabilities a user of *this specific product* would reasonably expect, that do not exist. Scored by how directly the current codebase implies them.

### Tier A — the product visibly promises these and does not deliver

| Gap | Evidence it is expected | Blast radius |
|---|---|---|
| **Session auto-completion** | `COMPLETED` exists in the enum, in the validator, and renders as a green badge in two components — but nothing ever sets it | Sessions stay `SCHEDULED` forever; historical reporting is meaningless |
| **Calendar view** | Sidebar nav item + route + `ui/calendar.tsx` installed | Dead-ends users who click it |
| **Settings page** | Route exists, is a placeholder, and is unreachable | Dead route |
| **Instructor session management** | API fully supports edit/cancel; no screen calls it | Instructors must ask an admin to move their own class |
| **Class reminder emails** | Email infrastructure is production-grade and idle between sessions | The single highest-value use of existing infrastructure |
| **Attendance/progress export** | Both overview pages are report-shaped but read-only | Admins will copy-paste from the browser |

### Tier B — standard for the category, cheap given what exists

Password reset · Welcome email with credentials · Server-side search & pagination · Date-range and batch filters on the two overview pages · Bulk attendance endpoint · Session detail page (currently a modal only) · Student attendance history detail · Per-student progress trend · Audit log · In-app toasts · React error boundary.

### Tier C — plausible next-version scope

Recurring sessions · Conflict detection · CSV student import · Certificates · Assignments/submissions · Resource/file sharing · Session feedback & ratings · Meeting recording links (blocked upstream — see the feasibility doc) · Real-time presence · Mobile app · Multi-tenant/organisation support.

### Explicitly out of scope — do not build
**Google Meet co-host, participant admission control, participant removal, end-meeting-for-all, and automatic recording.** [docs/google-meet-cohost-feasibility.md](docs/google-meet-cohost-feasibility.md) proves these are blocked by an account-level licensing limitation *and* an independent API-level limitation. Paying for Workspace does **not** make co-host assignment scriptable. This analysis is thorough, correctly sourced, and should be treated as settled.

---

## 8. DEAD CODE, PLACEHOLDERS & UNUSED ASSETS

| Item | Location | Verdict |
|---|---|---|
| `src/repositories/` | backend | Empty directory — abandoned layer |
| `src/types/` | backend | Empty directory |
| `updateSessionSchema` | [session.validator.ts:16](backend/src/validators/session.validator.ts#L16-L25) | Defined, exported, **never imported** — `PATCH /sessions/:id` runs unvalidated |
| `Session.meetingCode` | [schema.prisma:90](backend/prisma/schema.prisma#L90) | Written on create, **never read** anywhere |
| `Attendance.markedBy` | [schema.prisma:119](backend/prisma/schema.prisma#L119) | Written, **never read**, no FK |
| `SessionStatus.COMPLETED` | [schema.prisma:17](backend/prisma/schema.prisma#L17) | Rendered in the UI, never produced by the backend |
| `backend/dist/` (36 files) | tracked in git | Compiled output committed despite root `.gitignore`. **Stale** — predates the `services/email/` refactor and lacks those files entirely |
| `test.ts`, `test-api.ts`, `test-users.ts`, `test-post-user.ts` | backend root | Ad-hoc dev scratch scripts, not tests |
| `verify-attendance.ts`, `verify-session-actions.ts` | backend root | Manual E2E scripts that **write to the real database** and create Google Calendar events |
| `ui/calendar.tsx`, `ui/form.tsx`, `ui/popover.tsx`, `ui/tooltip.tsx` | frontend | Zero importers (`tooltip` is referenced only by a class name string) |
| `App.css` (184 lines) | frontend | Never imported — `main.tsx` imports only `index.css` |
| `assets/hero.png`, `react.svg`, `vite.svg` | frontend | Zero references |
| `railway.toml` / `railway.json` | backend | Deployment target is Render; `railway.toml` healthchecks the authenticated `/api/users` |
| `darkMode: ["class"]` + dark CSS vars | frontend | Configured, zero `dark:` utilities, no toggle |
| `.agents/` + `.claude/` skill packs (~70 files) | backend | Vendored Prisma tooling docs — harmless, but they are ~⅓ of the repo's file count |

---

## 9. SUMMARY

**Genuinely production-grade:** the dual-transport email subsystem, the Google Meet feasibility analysis, env fail-fast, graceful shutdown, and the error-handling middleware.

**Solid MVP, needs hardening:** all seven CRUD domains, the three dashboards, session scheduling, attendance, progress.

**Not production-ready:** authorization scoping, database migration history, observability, testing, and anything that requires a background job.

The largest single risk is not any individual bug — it is the **absence of a migration history** ([`backend/prisma/migrations/` is git-ignored](.gitignore#L34)), which means the production schema cannot be reproduced, reviewed, or rolled back.

See [TECHNICAL_AUDIT.md](TECHNICAL_AUDIT.md), [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md), and [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md).
