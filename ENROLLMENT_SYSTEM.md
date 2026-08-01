# Enrollment System — Implementation Report

**Project:** Student Training Portal
**Date:** 31 July 2026
**Scope:** Database, backend, frontend, email, authentication, bulk import/export, password lifecycle, validation, UX.

**Verification status at time of writing**

| Check | Result |
|---|---|
| `backend` — `tsc --noEmit` | ✅ 0 errors |
| `backend` — `npm test` (vitest) | ✅ 41 passed / 4 files |
| `frontend` — `tsc -p tsconfig.app.json --noEmit` | ✅ 0 errors |
| `frontend` — `vite build` | ✅ built in 588 ms |
| `frontend` — `oxlint` | ✅ 0 errors (8 pre-existing fast-refresh warnings) |
| Migrations applied to a database | ⛔ **Not applied — see §7** |
| Runtime / browser testing | ⛔ **Not performed — see §4 and §11** |

---

## 0. TWO THINGS TO READ FIRST

### 0.1 Migrations are generated but **not applied**

`DATABASE_URL` in `backend/.env` points at a live Supabase instance which was **unreachable** during this work (connection attempts hung until timeout — the project is most likely paused). Both migrations were therefore produced **offline** with `prisma migrate diff`, which never contacts a database.

Nothing has been run against your database. Applying them is a deliberate step you take, documented in **§7 Migration Guide**. Please read that section before deploying — the repository had **no migration history at all**, so a baseline step is required and getting it wrong on a populated database is the one genuinely risky action in this change set.

### 0.2 No screenshots

Deliverable 4 asked for UI screenshots. Producing real ones requires running the app against a working database, which was not available. Rather than present mock-ups as if they were captures, **§4 contains annotated ASCII wireframes** of every screen, matched line-for-line to the components that render them. Once the database is reachable, `npm run dev` in both packages will render exactly what those wireframes describe.

---

## 1. DATABASE CHANGES

### 1.1 Model changes

All new columns live on the existing `User` model. The app has always represented students, instructors and admins as one `User` row discriminated by `role`; introducing separate `Student` and `Instructor` tables would have broken every existing relation (`StudentBatch`, `InstructorBatch`, `Session.instructorId`, `Attendance.studentId`, `StudentProgress.studentId`) and every role filter. Extending `User` keeps 100% backward compatibility.

```prisma
model User {
  // ... all existing fields unchanged ...

  // --- Enrollment profile ---
  niatId         String? @unique   // STUDENT
  universityName String?           // STUDENT
  employeeId     String? @unique   // INSTRUCTOR

  techStackId String?
  techStack   TechStack? @relation("UserTechStack",
                 fields: [techStackId], references: [id], onDelete: SetNull)

  // --- Password lifecycle ---
  mustChangePassword Boolean   @default(true)
  passwordChangedAt  DateTime?

  // ... all existing relations unchanged ...

  @@index([role])
  @@index([techStackId])
  @@index([status, role])
}

model TechStack {
  // ... unchanged ...
  users User[] @relation("UserTechStack")   // new back-relation
}
```

### 1.2 Design decisions

| Decision | Reason |
|---|---|
| All new columns **nullable** | Every pre-existing row stays valid. No backfill needed for identifiers. |
| `@unique` on nullable columns | PostgreSQL permits multiple `NULL`s under a unique constraint, so legacy users without an identifier do not collide with one another. |
| `onDelete: SetNull` on `techStackId` | Deleting a tech stack must never cascade into deleting people. Contrast `Session.instructorId`, which is `Cascade` — a pre-existing latent data-loss risk noted in the earlier audit and deliberately left untouched here. |
| `mustChangePassword` defaults to `true` | Newly enrolled users are forced through the one-time change by construction, not by remembering to set a flag. |
| Existing rows backfilled to `false` | Current users chose their own passwords. Without the backfill, **every existing user including the admin would be locked out of the dashboard on their next login.** |
| Three new indexes | `role` is the most-used list filter; `techStackId` backs the new filter; `(status, role)` backs the combined filter. |

### 1.3 Generated migrations

```
backend/prisma/migrations/
├── migration_lock.toml
├── 20260731000000_baseline/migration.sql          186 lines — full existing schema
└── 20260731000100_enrollment_fields/migration.sql  new columns, indexes, FK, backfill
```

The baseline was generated from the schema **as it was before this change** (recovered from git), so it represents your current production database exactly. Verified: the baseline contains no `niatId`; the delta does.

`20260731000100_enrollment_fields/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "niatId" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "techStackId" TEXT,
ADD COLUMN     "universityName" TEXT;

CREATE UNIQUE INDEX "User_niatId_key"     ON "User"("niatId");
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
CREATE INDEX "User_role_idx"        ON "User"("role");
CREATE INDEX "User_techStackId_idx" ON "User"("techStackId");
CREATE INDEX "User_status_role_idx" ON "User"("status", "role");

ALTER TABLE "User" ADD CONSTRAINT "User_techStackId_fkey"
  FOREIGN KEY ("techStackId") REFERENCES "TechStack"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backward compatibility backfill (hand-added, not generated).
UPDATE "User"
SET "mustChangePassword" = false,
    "passwordChangedAt"  = COALESCE("passwordChangedAt", "updatedAt")
WHERE "mustChangePassword" = true;
```

### 1.4 One repository change you should know about

`.gitignore` previously contained `backend/prisma/migrations/`, which is why no migration history existed. That line has been **removed** and replaced with a comment explaining why the directory must stay tracked. Without this, the migrations produced here would have been invisible to git.

---

## 2. API CHANGES

### 2.1 Changed endpoints (all backward compatible)

| Endpoint | Change | Compatibility |
|---|---|---|
| `POST /api/auth/login` | Response `data.user` now includes `mustChangePassword`. Email is lower-cased before lookup. | ✅ Additive. Existing clients ignore the new field. |
| `GET /api/auth/me` | Now returns `name`, `email`, `status`, `mustChangePassword` — previously only `{id, role, status}`. | ✅ Additive, and **fixes a live bug**: the frontend types this response as `{id,name,email,role}`, so before this change every page refresh rendered `Hello, undefined` and a blank Profile page. |
| `POST /api/users` | `password` is now **optional**. When omitted, a secure password is generated and emailed. New optional fields: `niatId`, `universityName`, `employeeId`, `techStackId`. | ✅ A caller still sending `password` behaves exactly as before. |
| `GET /api/users` | New optional query params: `techStackId`, `universityName`, `status`, `search`. Response rows gain the enrollment fields and a nested `techStack`. | ✅ `?role=X` is unchanged. |
| `PATCH /api/users/:id` | Now accepts `email`, `niatId`, `universityName`, `employeeId`, `techStackId`. **Fields are now picked explicitly instead of forwarding the raw request body.** | ⚠️ Behaviour change — see below. |
| `PATCH /api/users/profile` | A password set here now also clears `mustChangePassword` and stamps `passwordChangedAt`. Policy raised from 6 chars to the full policy. | ⚠️ Passwords under the new policy are now rejected. |
| **All authenticated endpoints** | Return `403 Password change required.` while `mustChangePassword` is true, except the four allow-listed routes. | ⚠️ New gate — only affects users who have one pending. |

**On `PATCH /api/users/:id`:** previously the raw request body was forwarded straight into `prisma.user.update({ data })` typed as `Prisma.UserUpdateInput`, because the `validate()` middleware parses a *copy* of the request and discards the result. Any writable column therefore passed through regardless of the Zod schema — including `password`, which would be stored **unhashed**, permanently locking that account out of login. The service now allow-lists fields explicitly. The Edit User dialog silently depended on that hole to change emails, so `email` was added to both the schema and the allow-list in the same change; email editing continues to work.

### 2.2 New endpoints

| Method | Route | Purpose | Auth | Body / Query |
|---|---|---|---|---|
| `POST` | `/api/auth/change-password` | One-time / self-service password change | Bearer (allowed while gated) | `{currentPassword, newPassword, confirmPassword}` |
| `POST` | `/api/users/enroll/student` | Enroll one student | ADMIN | `{name, email, niatId, universityName, techStackId}` |
| `POST` | `/api/users/enroll/instructor` | Enroll one instructor | ADMIN | `{name, email, employeeId, techStackId}` |
| `GET` | `/api/users/import/:role/template` | Download CSV template | ADMIN | — |
| `POST` | `/api/users/import/:role/validate` | **Dry run.** Validate without writing | ADMIN | `text/csv` |
| `POST` | `/api/users/import/:role/failed-rows` | CSV of failing rows + reasons | ADMIN | `text/csv` |
| `POST` | `/api/users/import/:role` | Commit the import | ADMIN | `text/csv` |
| `GET` | `/api/users/export/:role` | Export filtered list as CSV | ADMIN | `?techStackId&universityName&status&search` |

`:role` is `students` or `instructors`.

### 2.3 Rate limits

| Bucket | Limit | Applies to |
|---|---|---|
| Global (pre-existing) | 100 / 15 min / IP | all `/api/*` |
| Credential | 10 / 15 min / IP, **successful requests not counted** | `POST /auth/login`, `POST /auth/change-password` |
| CSV validate | 30 / 15 min / IP | the two dry-run routes |
| Bulk import | 5 / 15 min / IP | `POST /users/import/:role` |

`skipSuccessfulRequests` on the credential bucket means a legitimate user is never throttled — only repeated *failures* consume budget.

---

## 3. NEW ROUTES

### Backend files

```
backend/src/
├── services/
│   ├── password.service.ts           NEW — PasswordGeneratorService
│   ├── enrollment-email.service.ts   NEW — EnrollmentEmailService
│   ├── csv-import.service.ts         NEW — CsvImportService
│   ├── csv-export.service.ts         NEW — CsvExportService
│   ├── user.service.ts               REWRITTEN — enrollment, filters, field allow-list
│   ├── auth.service.ts               REWRITTEN — mustChangePassword, changePassword
│   ├── email.service.ts              EXTENDED — public send(), per-recipient dispatch
│   └── email/
│       ├── types.ts                  EXTENDED — html?, perRecipient?
│       ├── SmtpMailer.ts             EXTENDED — html passthrough
│       └── GmailApiMailer.ts         EXTENDED — multipart/alternative MIME
├── utils/
│   ├── csv.ts                        NEW — RFC 4180 parse/serialise
│   ├── csv.test.ts                   NEW — 20 tests
│   └── ...
├── middlewares/auth.middleware.ts    REWRITTEN — typed req.user, password gate
├── controllers/{auth,user}.controller.ts   REWRITTEN
├── validators/{auth,user}.validator.ts     REWRITTEN
├── routes/{auth,user}.routes.ts            REWRITTEN
└── vitest.config.ts                  NEW
```

### Frontend files

```
frontend/src/
├── components/
│   ├── ui/toast.tsx                       NEW — toast system + errorMessage()
│   └── users/
│       ├── UserManagementPage.tsx         NEW — shared admin page (both roles)
│       ├── CsvImportDialog.tsx            NEW — 5-step wizard
│       ├── UserFormDialog.tsx             REWRITTEN — role-aware, no password field
│       └── UserTable.tsx                  REWRITTEN — enrollment columns
├── pages/
│   ├── ChangePasswordPage.tsx             NEW
│   ├── admin/StudentsManagement.tsx       REDUCED to 9 lines
│   ├── admin/InstructorsManagement.tsx    REDUCED to 9 lines
│   ├── Login.tsx                          EXTENDED — flag-aware redirect, spinner
│   └── ProfilePage.tsx                    EXTENDED — password policy aligned
├── contexts/AuthContext.tsx               EXTENDED — mustChangePassword, updateUser
├── layouts/DashboardLayout.tsx            EXTENDED — password gate
├── routes/AppRoutes.tsx                   EXTENDED — /change-password
└── App.tsx                                EXTENDED — ToastProvider
```

### New client route

| Path | Component | Guard |
|---|---|---|
| `/change-password` | `ChangePasswordPage` | Authenticated. Deliberately **outside** `DashboardLayout` — that layout redirects gated users here, so nesting it would loop forever. |

`StudentsManagement.tsx` and `InstructorsManagement.tsx` were ~95% identical (129 and 128 lines). Both are now 9-line wrappers over one `UserManagementPage`, so enrollment, import, export, search and filtering have exactly one implementation.

---

## 4. UI — ANNOTATED WIREFRAMES

Not screenshots. See §0.2.

### 4.1 Enroll Student dialog — `UserFormDialog.tsx` (role="STUDENT")

```
┌──────────────────────────────────────────────────┐
│  Enroll Student                              [×] │
│  Enroll a new student in the training programme. │
├──────────────────────────────────────────────────┤
│  Full Name                                       │
│  ┌────────────────────────────────────────────┐  │
│  │ e.g. Ravi Kumar                            │  │
│  └────────────────────────────────────────────┘  │
│  Email Address                                   │
│  ┌────────────────────────────────────────────┐  │
│  │ e.g. ravi.kumar@example.com                │  │
│  └────────────────────────────────────────────┘  │
│  NIAT ID                                         │
│  ┌────────────────────────────────────────────┐  │
│  │ e.g. NIAT2024001                           │  │
│  └────────────────────────────────────────────┘  │
│  University Name                                 │
│  ┌────────────────────────────────────────────┐  │
│  │ e.g. Anna University                       │  │
│  └────────────────────────────────────────────┘  │
│  Tech Stack                                      │
│  ┌────────────────────────────────────────────┐  │
│  │ Select tech stack                       ▾  │  │← loaded from /api/techstacks
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ 🔑 A secure password is generated          │  │
│  │    automatically and emailed to the        │  │← replaces the removed
│  │    student. They will be required to       │  │  "Temporary Password" field
│  │    change it on first login.               │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│                    [ Cancel ]  [ Enroll Student ]│
└──────────────────────────────────────────────────┘
```

The **Instructor** variant is identical except NIAT ID + University Name are replaced by a single **Employee ID** field, and the button reads **Enroll Instructor**.

### 4.2 Students page — `UserManagementPage.tsx`

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Students                        [+ Enroll Student] [⬆ Import CSV] [⬇ Export]│
│ Enroll students, import them in bulk, and manage their access.             │
├────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search by name, email or NIAT ID…   [Tech Stack ▾][University ▾][Status ▾]│
├────────────────────────────────────────────────────────────────────────────┤
│ Showing 12 of 48 students                                                  │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ Name          Email          NIAT ID   University  Stack  Status  Joined│ │
│ ├────────────────────────────────────────────────────────────────────────┤ │
│ │ Ravi Kumar    ravi@ex.com    NIAT001   Anna Univ   React  Active  31 Jul│ │
│ │  PENDING FIRST LOGIN ←── shown while mustChangePassword is still true   │ │
│ │ Asha Rao      asha@ex.com    NIAT002   VIT         Node   Active  31 Jul│ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

The Instructors page is the same component with `role="INSTRUCTOR"`: the University filter and column are hidden, and NIAT ID becomes Employee ID.

### 4.3 CSV import wizard — `CsvImportDialog.tsx`

```
  ①━━━━━②━━━━━③━━━━━④━━━━━⑤
Upload  Valid. Preview Import Result

STEP 1                          STEP 3  (preview)
┌──────────────────────────┐    ┌──────────────────────────────────┐
│ 📄 Start from the template│    │  ┌──────┐ ┌──────┐ ┌──────┐      │
│ Required: Name, Email,   │    │  │  48  │ │  45  │ │   3  │      │
│ NIAT ID, University,     │    │  │ Total│ │ Valid│ │Invalid│     │
│ Tech Stack. Max 500 rows.│    │  └──────┘ └──────┘ └──────┘      │
│ [⬇ Download CSV template]│    │ ⚠ 3 row(s) will be skipped.      │
├──────────────────────────┤    │              [⬇ Failed rows]     │
│    ⬆                     │    ├──────────────────────────────────┤
│  Click to choose a CSV   │    │ Row Name    Email      … Status  │
│  .csv only, up to 2 MB   │    │  2  Ravi    ravi@…      ✓ Valid  │
└──────────────────────────┘    │  3  (blank) x@y         ✗ Name   │
                                │                    is required   │
STEP 2 / STEP 4 (progress)      ├──────────────────────────────────┤
┌──────────────────────────┐    │ [Choose different file]          │
│         ⟳                │    │            [Import 45 students]  │
│  Validating students.csv…│    └──────────────────────────────────┘
│  Checking required       │
│  fields, duplicates and  │    STEP 5  (result)
│  tech stacks.            │    ┌──────────────────────────────────┐
└──────────────────────────┘    │            ✓                     │
                                │      Import complete             │
                                │  ┌──────┐ ┌──────┐ ┌──────┐      │
                                │  │  45  │ │   3  │ │   0  │      │
                                │  │Import│ │ Skip │ │ Fail │      │
                                │  └──────┘ └──────┘ └──────┘      │
                                │ ✉ 45 enrollment email(s) sent.   │
                                │        [⬇ Failed rows]  [Done]   │
                                └──────────────────────────────────┘
```

### 4.4 Change password — `ChangePasswordPage.tsx`

```
┌────────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────┐ │
│ │ ⚠ Password change required                 │ │← only when forced
│ │ You are signed in with a temporary         │ │
│ │ password. Choose a new one to continue.    │ │
│ └────────────────────────────────────────────┘ │
│ Change your password                           │
│ Signed in as ravi.kumar@example.com            │
├────────────────────────────────────────────────┤
│ Temporary password (from your email)           │
│ ┌────────────────────────────────────────────┐ │
│ │ ••••••••                                   │ │
│ └────────────────────────────────────────────┘ │
│ New password                                   │
│ ┌────────────────────────────────────────────┐ │
│ │ ••••••••                                   │ │
│ └────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────┐ │
│ │ ✓ At least 8 characters                    │ │← live checklist,
│ │ ✓ One uppercase letter                     │ │  updates as you type
│ │ ✗ One lowercase letter                     │ │
│ │ ✓ One number                               │ │
│ │ ✗ One special character                    │ │
│ └────────────────────────────────────────────┘ │
│ Confirm new password                           │
│ ┌────────────────────────────────────────────┐ │
│ │ ••••••••                                   │ │
│ └────────────────────────────────────────────┘ │
│        [ Change password and continue ]        │
│              ⎋ Sign out instead                │
└────────────────────────────────────────────────┘
```

---

## 5. FLOW DIAGRAMS

### 5.1 Single enrollment

```
Admin → Students page → [+ Enroll Student] → dialog (client-side zod)
                                                     │
                            POST /api/users/enroll/student
                                                     ▼
                                   authenticate → restrictTo(ADMIN)
                                                     ▼
                                          validate(enrollStudentSchema)
                                                     ▼
                                     UserService.enrollUser()
                                       ├ findConflicts()  ── email / NIAT / employee ID
                                       │                     all reported at once
                                       ├ verify techStackId exists
                                       ├ PasswordGeneratorService.generate()   12–16 chars
                                       ├ bcrypt.hash(password, 10)
                                       └ prisma.user.create({ mustChangePassword: true })
                                                     ▼
                            201 { user }   ← NOTE: no password in the response
                                                     │
                              void EnrollmentEmailService.sendEnrollmentEmail()
                                       │  fire-and-forget — never blocks, never fails enrollment
                                       ▼
                              EmailService.send({ perRecipient: true })
                                       ├ SMTP  ──(network failure only)──► Gmail API
                                       └ logs outcome; plaintext password discarded
                                                     ▼
                                   Toast: "Student enrolled — credentials emailed"
```

### 5.2 First login

```
Login (temporary password from email)
        ▼
POST /api/auth/login  →  200 { user: { …, mustChangePassword: true }, token }
        ▼
Client stores token, redirects to /change-password
        │
        │   ── if the user instead types /admin directly ──
        │        DashboardLayout sees mustChangePassword → <Navigate to="/change-password">
        │        AND the server returns 403 "Password change required." for the data calls
        ▼
POST /api/auth/change-password { currentPassword, newPassword, confirmPassword }
        ├ verify currentPassword with bcrypt.compare       ← proves possession of the emailed secret
        ├ reject if new === current
        ├ PasswordGeneratorService.validate(newPassword)
        └ update: password=hash, mustChangePassword=false, passwordChangedAt=now()
        ▼
updateUser({ mustChangePassword: false }) → navigate(homePathFor(role))
        ▼
Full dashboard access
```

### 5.3 Server-side gate

```
Any authenticated request
        ▼
authenticate()
   ├ verify JWT
   ├ re-read user row  (so deactivation and a completed change take effect immediately)
   ├ reject if missing / deactivated
   └ if mustChangePassword && NOT allow-listed  →  403 "Password change required."

Allow-list (the only four):
   POST   /api/auth/change-password
   POST   /api/auth/logout
   GET    /api/auth/me
   PATCH  /api/users/profile
```

The gate lives inside `authenticate` rather than as a separately-mounted middleware because that is the one place `req.user` is populated — so any protected route added in future is covered **by default**, not by remembering to chain another guard.

### 5.4 Bulk import

```
[Download template] → admin fills CSV → [Upload]
        ▼
File checks in the browser: .csv extension, ≤2 MB, non-empty
        ▼
POST /api/users/import/students/validate   (Content-Type: text/csv)
        ├ express.text({type:'text/csv', limit:'2mb'})   ← MIME + size gate
        ├ parseCsvTable()  → header validation, RFC 4180 parse
        ├ row cap 500
        ├ ONE tech-stack lookup, ONE existing-user lookup for the whole file
        └ per row: required fields · email format · intra-file duplicates ·
                   database duplicates · tech stack resolves
        ▼
Preview: total / valid / invalid + per-row errors + [Download failed rows]
        ▼
POST /api/users/import/students            (Content-Type: text/csv)
        ├ RE-VALIDATES from scratch  ← the DB can change between the two requests
        └ per valid row, sequentially:
              enrollUser() → generate password → hash → create
              sendEnrollmentEmail()  (failure counted, never fatal)
        ▼
Report: imported / skipped / failed / emailsSent / emailsFailed + error table
```

Rows are created **one at a time, not in a single transaction**: a 200-row import where row 173 collides should still enroll the other 199. Partial success is intended and is reported explicitly.

---

## 6. TESTING CHECKLIST

### 6.1 Automated (already passing)

```bash
cd backend && npm test        # 41 tests, 4 files
```

| File | Covers |
|---|---|
| `src/utils/csv.test.ts` | 20 tests — quoted fields, embedded commas/newlines, escaped quotes, CRLF, BOM, blank lines, unclosed quotes, stray quotes, header normalisation, missing headers, extra columns, header-only, empty file, formula-injection escaping, round-trip |
| `src/services/password.service.test.ts` | 15 tests — length bounds over 300 samples, all character classes present, self-consistency with `validate()`, ambiguous characters excluded, shuffle actually randomises position, uniqueness, policy boundary cases |
| `src/utils/jwt.test.ts`, `AppError.test.ts` | Pre-existing — **now actually run**; `npm test` previously was `echo "…" && exit 1` |

### 6.2 Manual — must be done once the database is reachable

**Backward compatibility (do these first)**

- [ ] Existing user logs in with their existing password → lands on their dashboard, **not** `/change-password`
- [ ] Existing admin can still create/edit/delete tech stacks, batches, sessions
- [ ] Session scheduling still creates a Google Meet link and sends notification emails
- [ ] Attendance marking and progress updates still work
- [ ] `GET /api/users?role=STUDENT` still returns the shape the older pages expect
- [ ] `POST /api/users` **with** an explicit `password` still creates the user (legacy path)

**Enrollment**

- [ ] Enroll a student — all five fields required, tech stack dropdown populated from `/api/techstacks`
- [ ] No "Temporary Password" field appears anywhere
- [ ] Duplicate email → single clear error
- [ ] Duplicate NIAT ID → single clear error
- [ ] Duplicate email **and** NIAT ID → both reported in one message
- [ ] Enroll an instructor — Employee ID replaces NIAT ID / University
- [ ] Response body contains **no** password field (check the network tab)
- [ ] Server logs contain **no** plaintext password

**Email**

- [ ] Student receives "Welcome to Internship Training Portal" with portal URL, email, temporary password
- [ ] Instructor receives the instructor variant
- [ ] HTML renders correctly in Gmail web, Gmail mobile, Outlook
- [ ] Plaintext fallback readable (view source / text-only client)
- [ ] A name containing `<b>` renders as literal text, not markup (HTML escaping)
- [ ] With SMTP down, enrollment **still succeeds** and the UI still reports success
- [ ] Each recipient's email lists only their own address in `To:`

**Password lifecycle**

- [ ] Login with the emailed password → redirected to `/change-password`
- [ ] Typing `/admin` directly still redirects to `/change-password`
- [ ] `curl` any other API route with that token → `403 Password change required.`
- [ ] `GET /api/auth/me` and `PATCH /api/users/profile` still work while gated
- [ ] Wrong current password → rejected
- [ ] New password same as current → rejected
- [ ] Each policy rule rejects independently; live checklist ticks as you type
- [ ] Mismatched confirmation → rejected
- [ ] After success → dashboard, `mustChangePassword=false`, `passwordChangedAt` set
- [ ] Log out and back in with the new password → straight to dashboard
- [ ] 11 failed logins in 15 minutes → rate limited; a successful login is not counted

**CSV import**

- [ ] Template downloads with correct headers and opens cleanly in Excel (BOM present)
- [ ] Valid 5-row file imports; 5 emails sent
- [ ] File with duplicate email **inside the file** → caught
- [ ] File with an email already in the database → caught
- [ ] File with a non-existent tech stack name → caught, names the stack
- [ ] File with missing required fields → caught per field
- [ ] Mixed valid/invalid → valid rows import, invalid skipped, counts correct
- [ ] "Download failed rows" returns only failures with an Errors column
- [ ] Non-CSV file → rejected client-side
- [ ] >2 MB file → rejected client-side
- [ ] 501-row file → rejected with the row-cap message
- [ ] Malformed CSV (unclosed quote) → clear parse error, no partial import
- [ ] File with quoted commas and newlines in names → parses correctly
- [ ] 6 imports in 15 minutes → rate limited
- [ ] `curl -H 'Content-Type: application/json'` to an import route → rejected

**CSV export**

- [ ] Students export has exactly: Name, Email, NIAT ID, University, Tech Stack, Status, Created Date
- [ ] Instructors export has exactly: Name, Email, Employee ID, Tech Stack, Status, Created Date
- [ ] **No password column in either**
- [ ] Applied filters are reflected in the exported rows
- [ ] A name beginning `=` is prefixed with `'` and does not execute in Excel

**Filters and search**

- [ ] Tech Stack / University / Status filters each narrow correctly, and combine
- [ ] Search matches name, email, NIAT ID, employee ID
- [ ] "Clear" resets everything; the count line updates

**UX**

- [ ] Toasts appear for every enroll / update / activate / deactivate / import / export, success and failure
- [ ] Spinners on login, enroll, import, export
- [ ] "Pending first login" badge shows only for users who have not rotated their password
- [ ] Wizard step indicator advances and marks completed steps

---

## 7. MIGRATION GUIDE

> The repository previously had **no migration history** (the directory was git-ignored). Step 2 baselines your existing database so Prisma knows the tables already exist. **Skipping it will make Prisma attempt to create tables that already exist.**

### Step 0 — Back up

```bash
pg_dump "$DIRECT_URL" > backup-$(date +%Y%m%d-%H%M).sql
```

Do this even on a staging database. Verify the file is non-empty.

### Step 1 — Bring the database online

`DATABASE_URL` was unreachable during implementation. Resume the Supabase project, then confirm:

```bash
cd backend && npx prisma migrate status
```

### Step 2 — Baseline (existing databases only, once)

Marks the baseline as already applied without executing it:

```bash
cd backend
npx prisma migrate resolve --applied 20260731000000_baseline
```

**For a brand-new empty database, skip this** — `migrate deploy` will run the baseline normally.

### Step 3 — Dry run on a copy (strongly recommended)

Restore your backup into a scratch database, point `DIRECT_URL` at it, and run steps 2 and 4 there first. This is the cheapest way to confirm the baseline is correct.

### Step 4 — Apply

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

### Step 5 — Verify the backfill

The single most important check. Every pre-existing user must be `false`:

```sql
SELECT "mustChangePassword", COUNT(*) FROM "User" GROUP BY 1;
```

Expect **all rows `false`** immediately after migration. If any are `true`, those users will be forced to change a password they never received by email — fix with:

```sql
UPDATE "User" SET "mustChangePassword" = false WHERE "createdAt" < NOW();
```

### Step 6 — Environment

Add to `backend/.env` and to Render:

```bash
PORTAL_URL="https://your-frontend.vercel.app"   # optional; falls back to CORS_ORIGIN
```

This is the URL printed in enrollment emails. If neither is set the email says "your Student Training Portal URL" rather than a broken link.

### Step 7 — Deploy

Change the Render build command so migrations run on every deploy:

```
npm install && npx prisma generate && npx prisma migrate deploy && npm run build
```

### Step 8 — Smoke test

1. Existing user logs in → dashboard, **not** `/change-password`
2. Enroll one test student → email arrives
3. Log in as that student → forced to `/change-password` → change → dashboard

### Rollback

The migration is additive apart from the backfill. To revert:

```sql
ALTER TABLE "User"
  DROP COLUMN "niatId", DROP COLUMN "universityName", DROP COLUMN "employeeId",
  DROP COLUMN "techStackId", DROP COLUMN "mustChangePassword", DROP COLUMN "passwordChangedAt";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260731000100_enrollment_fields';
```

Then redeploy the previous application build. No pre-existing data is touched by these columns.

---

## 8. CSV TEMPLATE EXAMPLES

Both templates are served live from `GET /api/users/import/:role/template` and begin with a UTF-8 BOM so Excel detects the encoding.

### Students — `students-import-template.csv`

```csv
Name,Email,NIAT ID,University Name,Tech Stack
Ravi Kumar,ravi.kumar@example.com,NIAT2024001,Anna University,React
```

A fuller example, showing quoting:

```csv
Name,Email,NIAT ID,University Name,Tech Stack
Ravi Kumar,ravi.kumar@example.com,NIAT2024001,Anna University,React
Asha Rao,asha.rao@example.com,NIAT2024002,VIT Vellore,Node.js
"Menon, Priya",priya.menon@example.com,NIAT2024003,"SRM Institute, Chennai",Python
```

### Instructors — `instructors-import-template.csv`

```csv
Name,Email,Employee ID,Tech Stack
Asha Rao,asha.rao@example.com,EMP1001,React
```

### Rules

| Rule | Detail |
|---|---|
| Headers | Case-, space- and underscore-insensitive: `NIAT ID`, `niat_id`, `niatid` all work |
| Extra columns | Ignored, not rejected — a spreadsheet with a Notes column still imports |
| Tech Stack | Must match an existing stack **name** exactly (case-insensitive). Create stacks first |
| Row cap | 500 per file |
| File size | 2 MB |
| Encoding | UTF-8; a BOM is stripped automatically |
| Line endings | LF or CRLF |
| Quoting | Standard RFC 4180 — wrap in `"` for embedded commas/newlines, `""` to escape a quote |
| Blank lines | Skipped |

### Failed-rows output

`POST /api/users/import/:role/failed-rows` returns the original columns plus an `Errors` column:

```csv
Name,Email,NIAT ID,University Name,Tech Stack,Errors
,bad-email,NIAT2024004,Anna University,React,Name is required; Email is not a valid address
Kiran S,kiran@example.com,NIAT2024001,VIT,Rust,A user with this NIAT ID already exists; Tech Stack "Rust" does not exist in the portal
```

Fix and re-upload that file directly.

---

## 9. SAMPLE ENROLLMENT EMAILS

Both are sent as `multipart/alternative` — plaintext first, HTML second (RFC 2046: clients render the *last* part they understand, so HTML clients get the rich version and everyone else a complete fallback).

### 9.1 Student — plaintext part

```
Subject: Welcome to Internship Training Portal
From:    "Student Training Portal" <portal@example.com>
To:      ravi.kumar@example.com

Hello Ravi Kumar,

Congratulations! You have been enrolled for Internship Training.

Portal URL        : https://training-portal.vercel.app
Email             : ravi.kumar@example.com
Temporary Password: Kf7#mQra2Xvz

Instructions:
  1. Log in using the credentials above.
  2. Change your password immediately - you will be prompted on first login.
  3. Never share your credentials with anyone.
  4. Contact your administrator if you face any issues.

Best Regards,
Student Training Portal
```

### 9.2 Student — HTML part (rendered)

```
┌──────────────────────────────────────────────┐
│ ████ (indigo accent bar)                     │
│                                              │
│ STUDENT TRAINING PORTAL                      │
│ Welcome aboard                               │
│                                              │
│ Hello Ravi Kumar, congratulations — you have │
│ been enrolled for Internship Training.       │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ YOUR LOGIN CREDENTIALS                   │ │
│ │ Portal URL   https://training-portal…    │ │
│ │ Email        ravi.kumar@example.com      │ │
│ │ Temporary    Kf7#mQra2Xvz   (monospace)  │ │
│ │ Password                                 │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [ Log in to the portal ]                     │
│                                              │
│ Next steps                                   │
│  1. Log in using the credentials above.      │
│  2. Change your password immediately — you   │
│     will be prompted automatically.          │
│  3. Never share your credentials.            │
│  4. Contact your administrator for issues.   │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ ⚠ Keep this password private. You will   │ │
│ │   be asked to replace it on first login. │ │
│ │   Staff will never ask you for it.       │ │
│ └──────────────────────────────────────────┘ │
│ ──────────────────────────────────────────── │
│ This is an automated message…                │
└──────────────────────────────────────────────┘
```

### 9.3 Instructor — plaintext part

```
Subject: Welcome to Internship Training Portal

Hello Asha Rao,

Your instructor account has been created.

Portal URL        : https://training-portal.vercel.app
Email             : asha.rao@example.com
Temporary Password: Tq4$wNbe9Hmk

Instructions:
  1. Log in using the credentials above.
  2. Change your password - you will be prompted on first login.
  3. Do not share your credentials with anyone.
  4. Contact your administrator if you face any issues.

Best Regards,
Student Training Portal
```

### 9.4 Email engineering notes

| Concern | Approach |
|---|---|
| Responsive | Table-based, inline styles, `max-width: 600px`, one media query collapsing padding under 600 px. Flexbox/grid and `<style>` blocks are unreliable in Outlook |
| Escaping | Names and university names are admin/CSV-supplied and land in an HTML document, so all interpolated values are HTML-escaped |
| Privacy | `perRecipient: true` — one message per recipient. A shared `To:` header would disclose the whole cohort's addresses alongside a password |
| Isolation | `EmailService` resolves, never rejects. Enrollment cannot be rolled back by a mail failure |
| Portal URL | `PORTAL_URL`, falling back to `CORS_ORIGIN`, falling back to descriptive text |
| Transport | Existing dual-transport stack unchanged — SMTP first, Gmail API over HTTPS/443 only on network-class failure |

---

## 10. SECURITY POSTURE

| Requirement | Implementation |
|---|---|
| Passwords never manually typed by admin | Field removed from the UI; the API no longer requires one |
| Cryptographically secure | `crypto.randomInt` (rejection-sampled, no modulo bias) for both character selection and the Fisher–Yates shuffle |
| 12–16 chars, all four classes | Length randomised in range; one character of each class seeded then shuffled, so the result cannot fail its own policy |
| Never logged | Verified by grep: no `console.*` statement references the plaintext. Flow is generate → hash → email body → discarded |
| Never returned again | `USER_PUBLIC_SELECT` has no `password` column; the enroll response carries only the user record |
| Never exported | Export column lists are explicit, and the service reads through `USER_PUBLIC_SELECT` |
| Hashed immediately | `bcrypt.hash(..., 10)` before `prisma.user.create` |
| File size limit | 2 MB at the body parser, plus a client-side pre-check |
| MIME validation | `express.text({ type: 'text/csv' })` — a non-CSV Content-Type never produces a string body |
| Header validation | `parseCsvTable` names the missing columns |
| Malformed CSV rejected | Unclosed quotes and stray quotes throw `CsvParseError` → 400 |
| Bulk import rate limited | 5 / 15 min; validation 30 / 15 min; credentials 10 / 15 min |
| CSV injection | Cells starting `= + - @` or a control character are prefixed with `'` |
| Mass assignment | `UserService.updateUser` allow-lists fields instead of forwarding `req.body` |
| Server-side gate | Enforced in `authenticate`, so new routes are covered by default |
| Possession proof | `changePassword` requires the current password even when forced |

### Deliberately left as-is

- **The `validate()` middleware still discards its parsed output.** Fixing it globally would silently strip fields that existing endpoints rely on receiving, which is exactly the kind of change that breaks working features. The actual vulnerability it enabled — mass assignment on `PATCH /users/:id` — is closed at the service layer instead. Fixing the middleware properly needs its own audit of all eight validated routes.
- **`Session.instructorId` remains `onDelete: Cascade`** — a pre-existing latent data-loss risk, out of scope here.
- **JWT still in `localStorage`, still no refresh tokens or revocation** — unchanged from before.

---

## 11. PRODUCTION READINESS ASSESSMENT

### 11.1 This feature

| Area | Score | Notes |
|---|---|---|
| Database design | 88 / 100 | Nullable + backfilled for compatibility; proper FK and indexes; real migrations at last. −12: identifiers live on `User` rather than role tables, which is right for compatibility but not a clean domain model |
| Password generation | 95 / 100 | CSPRNG throughout, class guarantees, no ambiguous glyphs, 15 tests. −5: no breach-list check |
| Password lifecycle | 88 / 100 | Forced change, possession proof, reuse rejection, policy shared client/server. −12: no expiry, no history, no reset-by-email flow |
| Auth gate | 90 / 100 | Enforced server-side inside `authenticate`, tight allow-list, client redirect as convenience. −10: allow-list is a literal array, not derived from route metadata |
| Enrollment email | 85 / 100 | Responsive HTML + plaintext, escaped, per-recipient, fully isolated. −15: **no retry and no persistence — a failed enrollment email is lost**, only visible in logs |
| CSV import | 85 / 100 | Dry-run preview, complete validation, partial success, failed-row export, 20 parser tests. −15: no streaming, 500-row cap, sequential email sending is slow for large files |
| CSV export | 90 / 100 | Filter-consistent, injection-safe, no credentials possible. −10: unpaginated, loads all matching rows into memory |
| Validation | 88 / 100 | Zod at both layers, all conflicts reported at once. −12: the `validate()` middleware weakness remains |
| UX | 85 / 100 | 5-step wizard, toasts everywhere, live password checklist, loading states throughout. −15: no error boundary, no virtualisation on the preview table |
| Security | 87 / 100 | See §10. −13: residual pre-existing weaknesses (localStorage token, no revocation) |
| Code quality | 86 / 100 | 4 focused services, duplicated pages collapsed to one, honest comments. −14: no tests for the enrollment/import services themselves (they need a Prisma test double) |
| **Testing** | **55 / 100** | 41 automated tests where there were effectively 0, and `npm test` works for the first time. −45: **no integration tests, and nothing has been exercised against a real database or browser** |

### **FEATURE SCORE: 85 / 100**

### 11.2 Effect on overall project readiness

The earlier audit scored the project **62/100**. This work moves several categories:

| Category | Before | After | Why |
|---|---|---|---|
| Database | 55 | **78** | Migration history now exists and is tracked — the single Critical finding from the audit |
| Authentication | 74 | **82** | `/auth/me` bug fixed; password lifecycle; login rate limiting |
| Backend | 68 | **74** | Four focused services; explicit field allow-listing; per-route rate limits |
| Frontend | 65 | **72** | Toasts, loading states, duplication removed. Still no error boundary |
| Security | 65 | **72** | Mass assignment closed; credential emails isolated; CSV injection handled |
| Testing & CI | 10 | **40** | `npm test` works; 41 tests. Still no integration tests or CI |
| Maintainability | 50 | **58** | Two ~identical pages became one; new code is tested and documented |

**Estimated overall: 62 → 71 / 100.**

### 11.3 Ship / hold

**Ready to ship** once §7 is completed and §6.2 passes:
single and bulk enrollment, generated passwords, enrollment emails, forced first-login password change, CSV import/export, filters and search.

**Hold for a follow-up:**

1. **Enrollment email retry.** The highest-value gap. If SMTP and the Gmail API are both unavailable, a user is enrolled with a password nobody ever receives, recoverable only by an admin re-enrolling them. An `EmailOutbox` table plus a retry job fixes it — and the wider system already needs a job runner for reminders and session auto-completion.
2. **Password reset by email.** Today a locked-out user needs admin intervention, and there is no non-destructive admin tool to help them.
3. **Pagination.** `GET /api/users` is still unbounded, and both the export and the import preview load everything into memory.
4. **Integration tests** for `UserService.enrollUser` and `CsvImportService` against a test database.
5. **React error boundary.** Still absent despite `DEPLOYMENT_CHECKLIST.md` claiming otherwise.

### 11.4 Honest limitations

- **Nothing has been run.** No migration applied, no HTTP request issued, no page rendered. Every claim about runtime behaviour is derived from source and from a clean typecheck/build/test run. §6.2 exists precisely because that gap is real.
- **Email rendering is unverified** across clients. The HTML follows standard table-based practice but has not been through Litmus or a real Outlook.
- **The 500-row import cap is a judgement call**, chosen to bound request size, transaction time and outbound mail volume. Larger cohorts need streaming and a job queue rather than a raised limit.
- **Sequential email sending** in bulk import means a 500-row file takes 500 sequential API round-trips. Correct and quota-safe, but slow; the wizard warns the user to keep the dialog open.
