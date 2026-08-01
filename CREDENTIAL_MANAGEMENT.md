# Enrollment & Credential Management — Implementation Report

**Project:** Student Training Portal
**Date:** 31 July 2026
**Scope:** Extension of the existing enrollment system. Nothing in the enrollment flow was redesigned.
**Builds on:** [ENROLLMENT_SYSTEM.md](ENROLLMENT_SYSTEM.md)

**Verification status**

| Check | Result |
|---|---|
| `backend` — `tsc --noEmit` | ✅ 0 errors |
| `backend` — `npm test` | ✅ 41 passed / 4 files |
| `frontend` — `tsc -p tsconfig.app.json --noEmit` | ✅ 0 errors |
| `frontend` — `vite build` | ✅ built in 493 ms |
| `frontend` — `oxlint` | ✅ 0 errors |
| Migration applied to a database | ⛔ **Not applied — DB still unreachable (see §3)** |
| Runtime / browser testing | ⛔ **Not performed (see §6, §8)** |

---

## 0. ONE DESIGN DECISION YOU NEED TO AGREE WITH

### Feature 3 and Feature 13 pull in opposite directions

- **Feature 3** requires the generated temporary password to be shown in a dialog after enrollment.
- **Feature 13** requires that passwords are *never* returned through APIs.

Both cannot be literally true. The resolution implemented here is the standard one-time-disclosure pattern (the same contract AWS uses for secret access keys):

> The plaintext password is returned in **exactly one** HTTP response — the `201` from enrollment, or the `200` from a password reset. It is never persisted in plaintext, never logged, never exported, and **no endpoint can retrieve it afterwards.** Once that response is discarded the value is unrecoverable.

Verified by grep at implementation time — `temporaryPassword` leaves the server in exactly two places, both of them that one-time disclosure:

```
user.controller.ts:103   enrollStudent / enrollInstructor  201 response
user.controller.ts:237   resetPassword                     200 response
```

If you would rather the password never reach the browser at all, the change is small: drop those two fields and make Reset Password the only remediation for a failed email. Say the word and I will do it — but then a failed credential email means the admin has no way to get that user in without a second reset.

### Feature 6 confirms what the architecture already forced

Your brief anticipated this correctly. Because plaintext is never stored, **Resend Credentials cannot resend the original password.** It is implemented honestly rather than being quietly turned into a silent reset:

- `POST /users/:id/resend-credentials` returns **409** with `{ requiresPasswordReset: true }`.
- The attempt is written to the audit trail as `CREDENTIAL_RESEND_BLOCKED` — an admin trying and being redirected is itself worth recording.
- The UI treats that 409 as the *normal* path and opens the Reset Password confirmation directly, so the admin lands on the action that works in one click.

`credentialRetryCount` is deliberately **not** incremented here: nothing was transmitted, and inflating a delivery-attempt counter for a non-attempt would make the metric lie.

---

## 1. DATABASE CHANGES

### 1.1 New enums

```prisma
enum CredentialStatus { PENDING  SENT  FAILED }

enum EnrollmentEventType {
  ENROLLED   CREDENTIAL_SENT   CREDENTIAL_FAILED   CREDENTIAL_RESEND_BLOCKED
  PASSWORD_RESET   PASSWORD_CHANGED   FIRST_LOGIN
  ACTIVATED   DEACTIVATED   PROFILE_UPDATED
}
```

### 1.2 `User` — six new columns

```prisma
model User {
  // ... everything existing is unchanged ...

  firstLoginAt DateTime?          // stamped once, on first successful login

  credentialStatus        CredentialStatus @default(PENDING)
  credentialSentAt        DateTime?
  credentialFailureReason String?
  credentialRetryCount    Int              @default(0)
  credentialLastRetryAt   DateTime?

  enrollmentEvents EnrollmentEvent[] @relation("EnrollmentEventSubject")
  actedEvents      EnrollmentEvent[] @relation("EnrollmentEventActor")

  @@index([credentialStatus])
  @@index([mustChangePassword])
}
```

`firstLoginAt` is the one field beyond your list. It exists so Feature 8's "First Login" event can be recorded **without querying the event table on every single login** — the column is checked, and the write happens exactly once per account.

### 1.3 `EnrollmentEvent` — the audit trail

```prisma
model EnrollmentEvent {
  id      String              @id @default(uuid())
  userId  String
  type    EnrollmentEventType
  detail  String?             // failure reason, deactivation reason — never a credential
  actorId String?             // admin who acted; NULL for self-service/system events

  createdAt DateTime @default(now())

  user  User  @relation("EnrollmentEventSubject", fields: [userId],  references: [id], onDelete: Cascade)
  actor User? @relation("EnrollmentEventActor",  fields: [actorId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([type])
  @@index([createdAt])
}
```

| Decision | Reason |
|---|---|
| `actorId` is `SetNull` on delete | Removing an admin must never erase the record of what they did. |
| `userId` is `Cascade` | An account's history is meaningless once the account is gone, and leaving orphans would break the timeline query. |
| `detail` capped at 500 chars in code | A pathological provider error string cannot bloat the table. |
| Append-only | Nothing in the codebase updates or deletes an event. |

### 1.4 Migration — `20260731000200_credential_management`

Generated offline with `prisma migrate diff`. Contains the two enums, the six columns, the `EnrollmentEvent` table, five indexes, two foreign keys — plus a hand-added backfill:

```sql
-- Backward compatibility backfill.
--
-- credentialStatus defaults to PENDING, which is right for a newly enrolled
-- user awaiting their email and WRONG for every account predating the
-- enrollment system. Left at PENDING they would sit in the "Pending
-- Credentials" card forever and make the metric useless.
UPDATE "User"
SET "credentialStatus" = 'SENT',
    "credentialSentAt"  = COALESCE("credentialSentAt", "createdAt")
WHERE "mustChangePassword" = false;
```

Without this, every existing user would show as ⌛ Pending on day one.

---

## 2. API DOCUMENTATION

### 2.1 New endpoints

#### `GET /api/users/credential-status`
Aggregate metrics for the dashboard. **ADMIN.** Routed *before* `/:id` so the literal path is not captured as a user id.

```jsonc
{ "success": true, "data": {
    "sent": 128, "failed": 3, "pending": 12, "awaitingPasswordChange": 15,
    "recentlyEnrolled": [ /* up to 10 users, last 7 days */ ],
    "failures":         [ /* up to 20 users with credentialStatus = FAILED */ ]
}}
```

Uses `count` queries, not row fetches, so it stays cheap as the table grows.

#### `POST /api/users/:id/resend-credentials`
**ADMIN.** Rate limited 30/15 min. Expected outcome is **409**:

```jsonc
// 409 — the normal path
{ "success": false,
  "data": { "requiresPasswordReset": true },
  "message": "The temporary password cannot be resent because it is never stored in plaintext. Use \"Reset Password\" to generate and email a new one." }

// 400 — user already set their own password
{ "success": false, "message": "This user has already set their own password, so there are no temporary credentials to resend." }
```

Side effect: records `CREDENTIAL_RESEND_BLOCKED`.

#### `POST /api/users/:id/reset-password`
**ADMIN.** Rate limited 30/15 min.

Generates a new password → hashes → `mustChangePassword=true`, `passwordChangedAt=null`, `credentialStatus=PENDING` → emails → records the delivery outcome.

```jsonc
{ "success": true,
  "data": {
    "user": { /* full public user, with the post-send credential status */ },
    "temporaryPassword": "Kf7#mQra2Xvz",   // one-time disclosure
    "credentialDelivered": true,
    "credentialFailureReason": null
  },
  "message": "Password reset. The new credentials have been emailed." }
```

Guard: **403** if the target is another ADMIN. Resetting a peer admin's password is an account-takeover primitive; admins rotate their own password through the profile screen.

Audit: `PASSWORD_RESET`, then `CREDENTIAL_SENT` or `CREDENTIAL_FAILED`.

#### `GET /api/users/:id/enrollment-history`
**ADMIN.** Newest first, capped at 100.

```jsonc
{ "success": true, "data": [
  { "id": "…", "type": "CREDENTIAL_FAILED",
    "label": "Credential email failed", "tone": "bad",
    "detail": "The SMTP server could not be reached — …",
    "actor": null, "createdAt": "2026-07-31T09:14:02.113Z" }
]}
```

`label` and `tone` are computed server-side so the frontend never keeps a duplicate copy of the event enum in sync.

### 2.2 Changed endpoints

| Endpoint | Change | Compatibility |
|---|---|---|
| `POST /users/enroll/student`<br>`POST /users/enroll/instructor` | Response `data` changed from the bare user object to `{ user, temporaryPassword, credentialDelivered, credentialFailureReason }`. Email is now **awaited** so the response can report delivery. | ⚠️ **Response shape change.** Both callers are in this repo and were updated. Any external integration reading `data.id` must move to `data.user.id`. |
| `PATCH /users/:id` | Accepts `statusReason` (≤300 chars). A `status` change now routes through `CredentialService.setStatus` for the audit event and guard rails. | ✅ Additive. `{status: false}` alone still works. |
| `GET /users` | New `?credentialStatus=` filter. Rows now carry the six credential fields plus `firstLoginAt`. | ✅ Additive. |
| `POST /auth/login` | Stamps `firstLoginAt` and records `FIRST_LOGIN` on the first successful login. | ✅ No response change. |
| `POST /auth/change-password` | Records `PASSWORD_CHANGED`. | ✅ No response change. |
| `POST /users` (legacy) | Delivery outcome now recorded; `actorId` captured. | ✅ Response unchanged. |
| CSV import | Per-user delivery outcome recorded against each user; `actorId` captured as "Created By". | ✅ Report shape unchanged. |

### 2.3 New guard rails

| Rule | Behaviour |
|---|---|
| Cannot deactivate yourself | 400 |
| Cannot reset another ADMIN's password | 403 |
| Resend only while `mustChangePassword` | 400 otherwise |
| No-op status change | Returns the user without padding the timeline |
| Credential-action rate limit | 30 / 15 min / IP on resend + reset |

---

## 3. MIGRATION

The database was still unreachable, so this migration is **generated but not applied** — same position as the previous one.

```
backend/prisma/migrations/
├── 20260731000000_baseline/               (existing schema)
├── 20260731000100_enrollment_fields/      (enrollment system)
└── 20260731000200_credential_management/  ← NEW
```

Apply all three together, following §7 of [ENROLLMENT_SYSTEM.md](ENROLLMENT_SYSTEM.md) — the baseline step is unchanged and still required.

```bash
cd backend
npx prisma migrate resolve --applied 20260731000000_baseline   # existing DBs only, once
npx prisma migrate deploy
npx prisma generate
```

### Post-migration verification

```sql
-- 1. No pre-existing user should be left Pending.
SELECT "credentialStatus", COUNT(*) FROM "User" GROUP BY 1;
--    expect: SENT = all pre-existing rows, PENDING = 0

-- 2. Existing users must still not be forced through a password change.
SELECT "mustChangePassword", COUNT(*) FROM "User" GROUP BY 1;
--    expect: all false

-- 3. Audit table exists and is empty.
SELECT COUNT(*) FROM "EnrollmentEvent";   -- expect 0
```

### Rollback

```sql
DROP TABLE "EnrollmentEvent";
ALTER TABLE "User"
  DROP COLUMN "credentialStatus", DROP COLUMN "credentialSentAt",
  DROP COLUMN "credentialFailureReason", DROP COLUMN "credentialRetryCount",
  DROP COLUMN "credentialLastRetryAt", DROP COLUMN "firstLoginAt";
DROP TYPE "CredentialStatus";
DROP TYPE "EnrollmentEventType";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260731000200_credential_management';
```

Additive apart from the backfill; no pre-existing column is modified.

---

## 4. UI CHANGES

Wireframes, not screenshots — the app still cannot be run against a database.

### 4.1 Enrollment confirmation (Feature 3)

```
┌──────────────────────────────────────────────────┐
│ ✓ Student Enrolled Successfully                  │
│ Credentials have been emailed. You can also      │
│ copy them below.                                 │
├──────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐ │
│ │ Name                            Ravi Kumar   │ │
│ │ ──────────────────────────────────────────── │ │
│ │ Email              ravi.kumar@example.com    │ │
│ │ ──────────────────────────────────────────── │ │
│ │ Temporary Password        Kf7#mQra2Xvz       │ │← monospace, select-all
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ 🛡 This password is shown only once. It is   │ │
│ │   never stored in plaintext and cannot be    │ │
│ │   retrieved again. If lost, use Reset        │ │
│ │   Password to issue a new one.               │ │
│ └──────────────────────────────────────────────┘ │
│ ✉ Sent to ravi.kumar@example.com                 │
│                    [ Copy Credentials ]  [ Done ]│
└──────────────────────────────────────────────────┘
```

Escape and click-outside are **disabled** on this dialog — closing it destroys the only copy, so it must be a deliberate click on Done.

**When the email failed**, an amber panel is inserted above the credential block:

```
│ ┌──────────────────────────────────────────────┐ │
│ │ ⚠ Credential email not delivered             │ │
│ │   The SMTP server could not be reached …     │ │
│ │   Copy the password below and pass it on     │ │
│ │   securely — it cannot be retrieved later.   │ │
│ └──────────────────────────────────────────────┘ │
```

### 4.2 Admin notification (Feature 2)

```
                          ┌────────────────────────────────────┐
                          │ ⚠ Student enrolled successfully.   │
                          │   However, the credential email    │
                          │   could not be delivered. Copy the │
                          │   password before closing the      │
                          │   dialog.                      [×] │
                          └────────────────────────────────────┘
```

Toast plus the dashboard's **Credential Delivery Failed** panel (§4.5).

### 4.3 Welcome screen (Feature 4)

```
        ┌──────────────────────────────────────────┐
        │                   🎉                     │
        │  Welcome to Internship Training Portal   │
        ├──────────────────────────────────────────┤
        │            Hello Ravi Kumar              │
        │  Your account has been created           │
        │  successfully.                           │
        │                                          │
        │  Before continuing, please change your   │
        │  temporary password.                     │
        │  ┌────────────────────────────────────┐  │
        │  │ 🛡 You are signed in with the      │  │
        │  │   temporary password emailed to    │  │
        │  │   you. Choosing your own keeps     │  │
        │  │   your account secure.             │  │
        │  └────────────────────────────────────┘  │
        │        [      Continue  →      ]         │
        └──────────────────────────────────────────┘
```

Flow: `Login → /welcome → Continue → /change-password → Dashboard`.

Acknowledgement is held in `sessionStorage`, so refreshing mid-flow resumes at the password form instead of restarting onboarding. It is onboarding chrome, not access control — the server gate is unchanged and still returns `403 Password change required.` regardless.

### 4.4 Table and actions (Features 5, 11)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Name        Email        NIAT ID   University  Stack  Status   Credentials  Joined │
├───────────────────────────────────────────────────────────────────────────────────┤
│ Ravi Kumar  ravi@ex.com  NIAT001   Anna Univ   React  Active   ✓ Sent      31 Jul  │
│  PENDING FIRST LOGIN                                                          [⋯] │
│ Asha Rao    asha@ex.com  NIAT002   VIT         Node   Active   ⚠ Failed     31 Jul │
│ Kiran S     kiran@ex.com NIAT003   SRM         Python Inactive ⌛ Pending    30 Jul │
└───────────────────────────────────────────────────────────────────────────────────┘

  [⋯] ─┬─ 👁 View
       ├─ ✎ Edit Details
       ├───────────────────
       ├─ ➤ Resend Credentials     (disabled once they set their own password)
       ├─ 🔑 Reset Password
       ├─ 🕐 Enrollment History
       ├───────────────────
       └─ ⏻ Deactivate / Activate
```

The ⚠ Failed badge carries the failure reason as a `title` tooltip. Badges pair an icon with a text label so status is never conveyed by colour alone.

### 4.5 Dashboard cards (Feature 10)

```
┌──────────────────┐┌──────────────────┐┌──────────────────┐┌──────────────────┐
│ Credential       ││ Credential       ││ Pending          ││ Awaiting         │
│ Emails Sent   ✉  ││ Failures      ✉  ││ Credentials   ⌛ ││ Password Chg  🔑 │
│      128         ││       3          ││       12         ││       15         │
│                  ││ Needs attention  ││                  ││ Have not set own │
└──────────────────┘└──────────────────┘└──────────────────┘└──────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Credential Delivery Failed                                                  │
│ These accounts exist but never received their credentials. Use Reset Password.│
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ Asha Rao   asha@ex.com                                                    │ │
│ │ The SMTP server could not be reached …                          Manage →  │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│ 👤 Recently Enrolled — last 7 days                                            │
│ Name          Role        Credentials   Enrolled                              │
│ Ravi Kumar    student     ✓ Sent        31 Jul 2026                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Enrollment history (Feature 8)

```
┌────────────────────────────────────────────────────┐
│ 🕐 Enrollment History                              │
│ Every credential and access event for Ravi Kumar   │
├────────────────────────────────────────────────────┤
│ ● Password changed by user      31 Jul 2026 14:22  │
│ │  Temporary password replaced by the user         │
│ │  by the user / system                            │
│ ● First login                   31 Jul 2026 14:20  │
│ │  by the user / system                            │
│ ● Credential email sent         31 Jul 2026 09:15  │
│ │  by Super Admin                                  │
│ ● Credential email failed       31 Jul 2026 09:14  │
│ │  The SMTP server could not be reached …          │
│ │  by Super Admin                                  │
│ ● Enrolled                      31 Jul 2026 09:14  │
│    Enrolled as STUDENT · by Super Admin            │
└────────────────────────────────────────────────────┘
```

Newest first. Dots are green/red/grey by tone; the label carries the meaning.

### 4.7 Deactivate / reactivate (Feature 9)

```
┌──────────────────────────────────────────────────┐
│ ⏻ Deactivate Ravi Kumar?                         │
│ They will be signed out and blocked from logging │
│ in. Their enrollment, attendance and progress    │
│ records are preserved.                           │
├──────────────────────────────────────────────────┤
│ Reason (optional)                                │
│ ┌──────────────────────────────────────────────┐ │
│ │ e.g. Left the programme early                │ │
│ └──────────────────────────────────────────────┘ │
│ Recorded in this account's enrollment history.   │
│                                          0/300   │
│                    [ Cancel ]  [ Deactivate ]    │
└──────────────────────────────────────────────────┘
```

The reason is genuinely optional — requiring it produces filler text, which is worse for whoever reads the history later. Login prevention is unchanged: `authenticate` already rejects `status = false` with 403 on every request.

---

## 5. FILES

### Backend

```
NEW  src/services/credential.service.ts          CredentialService
NEW  src/services/enrollment-history.service.ts  EnrollmentHistoryService
MOD  src/services/email.service.ts               send() returns SendResult, not boolean
MOD  src/services/email/types.ts                 SendResult.reason
MOD  src/services/email/SmtpMailer.ts            reason on every failure return
MOD  src/services/email/GmailApiMailer.ts        reason on every failure return
MOD  src/services/enrollment-email.service.ts    returns {delivered, reason}
MOD  src/services/user.service.ts                credential fields, ENROLLED event, actorId
MOD  src/services/auth.service.ts                FIRST_LOGIN, PASSWORD_CHANGED
MOD  src/services/csv-import.service.ts          per-user delivery outcome + actorId
MOD  src/controllers/user.controller.ts          4 handlers, one-time disclosure, status routing
MOD  src/routes/user.routes.ts                   4 routes + credentialActionLimiter
MOD  src/validators/user.validator.ts            statusReason, userIdParamSchema
MOD  prisma/schema.prisma                        2 enums, 6 columns, EnrollmentEvent
NEW  prisma/migrations/20260731000200_credential_management/
```

### Frontend

```
NEW  src/components/users/CredentialBadge.tsx            ✓ Sent / ⚠ Failed / ⌛ Pending
NEW  src/components/users/CredentialsDialog.tsx          one-time copy-credentials
NEW  src/components/users/EnrollmentHistoryDialog.tsx    audit timeline
NEW  src/components/users/UserViewDialog.tsx             read-only detail
NEW  src/components/users/StatusChangeDialog.tsx         confirm + optional reason
NEW  src/components/users/CredentialDashboardCards.tsx   dashboard cards
NEW  src/pages/WelcomePage.tsx                           welcome screen
NEW  src/lib/onboarding.ts                               sessionStorage helpers
MOD  src/components/users/UserTable.tsx                  credential column, 6-action menu
MOD  src/components/users/UserManagementPage.tsx         wires every action
MOD  src/pages/AdminDashboard.tsx                        credential section
MOD  src/pages/Login.tsx                                 routes via /welcome
MOD  src/layouts/DashboardLayout.tsx                     welcome-then-change gate
MOD  src/routes/AppRoutes.tsx                            /welcome
```

`onboarding.ts` exists because importing the helpers directly from `WelcomePage` made the router statically import a lazily-routed page, which silently defeated its code-splitting. Vite warned; the extraction fixed it.

---

## 6. TESTING CHECKLIST

### 6.1 Automated (passing)

`cd backend && npm test` → 41 tests, 4 files. Unchanged from the previous phase — the new services need a Prisma test double, which is called out in §8.

### 6.2 Manual — once the database is reachable

**Backward compatibility — do these first**

- [ ] Existing user logs in normally; no welcome screen, no forced change
- [ ] Existing users show ✓ Sent, not ⌛ Pending, after migration
- [ ] Sessions, attendance, progress, batches, tech stacks all still work
- [ ] CSV import and export still work; export still has no password column
- [ ] `POST /api/users` with an explicit password still creates a user

**Feature 1 — delivery tracking**

- [ ] Enroll with working email → `credentialStatus = SENT`, `credentialSentAt` set
- [ ] Stop SMTP and unset `GMAIL_REFRESH_TOKEN`, enroll → **enrollment still succeeds**
- [ ] …and `credentialStatus = FAILED`, `credentialFailureReason` populated, `credentialRetryCount = 1`
- [ ] Failure reason is a classification string, never a password

**Features 2 & 3 — notification and copy**

- [ ] Success → green toast + dialog showing name, email, password
- [ ] Failure → amber toast "…credential email could not be delivered" + amber panel in dialog
- [ ] Copy Credentials copies all four lines; button shows "Copied"
- [ ] Escape and click-outside do **not** close the dialog; Done does
- [ ] Password is not present in any subsequent `GET /api/users` response
- [ ] Password does not appear in the server log

**Feature 4 — welcome screen**

- [ ] First login on a new account → `/welcome`, not `/change-password`
- [ ] Continue → `/change-password`
- [ ] Refresh on `/change-password` stays there (does not bounce back to welcome)
- [ ] Typing `/admin` directly → still gated
- [ ] After the change → dashboard; logging out and back in skips welcome entirely

**Features 5 & 11 — badges and actions**

- [ ] Credential column shows the right badge for all three states
- [ ] Failed badge tooltip shows the reason
- [ ] All six actions present; Resend disabled once `mustChangePassword` is false
- [ ] View dialog shows credential status, attempts, first login, password-changed
- [ ] Same behaviour on the Instructors page

**Feature 6 — resend**

- [ ] Resend on a pending user → Reset Password confirmation opens directly
- [ ] `CREDENTIAL_RESEND_BLOCKED` appears in that user's history
- [ ] `credentialRetryCount` did **not** change
- [ ] Resend on a user who already changed their password → 400

**Feature 7 — reset**

- [ ] Reset → new password dialog; old password no longer works
- [ ] New password works and forces welcome → change-password
- [ ] `mustChangePassword = true`, `passwordChangedAt = null`
- [ ] `PASSWORD_RESET` then `CREDENTIAL_SENT`/`CREDENTIAL_FAILED` in history
- [ ] Resetting another ADMIN → 403
- [ ] With email down: reset still succeeds, dialog shows the password, status FAILED

**Feature 8 — history**

- [ ] Full lifecycle produces: Enrolled → Credential sent → First login → Password changed
- [ ] Newest first; actor shown for admin actions, "user / system" otherwise
- [ ] Deactivation reason appears as the event detail
- [ ] Admin who performed an action is named correctly

**Feature 9 — deactivate/reactivate**

- [ ] Confirmation dialog appears; reason optional
- [ ] Deactivated user cannot log in (403)
- [ ] Inactive badge shows in the table
- [ ] Both events recorded with reason
- [ ] Deactivating yourself → 400

**Feature 10 — dashboard**

- [ ] Four cards show correct counts
- [ ] Failure panel appears only when failures exist, and lists them
- [ ] Recently Enrolled lists last-7-day enrollments with badges
- [ ] Counts update after enrolling / resetting

**Feature 13 — security**

- [ ] `grep -ri "password" server.log` shows no plaintext
- [ ] Exported CSV has no password column
- [ ] `GET /api/users/:id` never returns a password
- [ ] 31 credential actions in 15 min → rate limited
- [ ] Non-admin calling any credential endpoint → 403

---

## 7. SECURITY

| Requirement | Implementation | Verified |
|---|---|---|
| Never log plaintext | No `console.*` references a password variable | ✅ grep |
| Never export | Export column lists are explicit; service reads through `USER_PUBLIC_SELECT`, which has no `password` | ✅ grep |
| Never returned after the dialog closes | Plaintext leaves the server in exactly 2 places, both one-time disclosures | ✅ grep |
| Never stored in plaintext | bcrypt cost 10 before any write; this is *why* resend cannot work | ✅ code |
| Audit every credential action | 10 event types across enroll, send, fail, resend-blocked, reset, change, first login, activate, deactivate, profile | ✅ code |
| Audit cannot break the app | `EnrollmentHistoryService.record` swallows its own errors | ✅ code |
| Audit survives admin deletion | `actorId` is `SetNull` | ✅ schema |
| Rate limited | 30/15 min on resend + reset | ✅ code |
| Admin-only | All four endpoints sit below `restrictTo('ADMIN')` | ✅ code |
| No admin-on-admin reset | 403 | ✅ code |
| No self-deactivation | 400 | ✅ code |

**Residual, unchanged from before:** JWT in `localStorage`, no refresh tokens, no token revocation. Out of scope here.

---

## 8. PRODUCTION READINESS

### 8.1 This module

| Area | Score | Notes |
|---|---|---|
| Delivery tracking | 90 | Real reasons threaded from the transport layer, not a generic flag. −10: no automatic retry |
| Audit trail | 88 | Append-only, actor-attributed, survives admin deletion, never breaks callers. −12: no retention policy or pagination beyond the 100 cap |
| Resend / reset | 92 | Honest about the plaintext constraint; guard rails on both. −8: resend is necessarily a dead end by design |
| Credential dashboard | 85 | Server-side aggregates, actionable failure list. −15: no date filtering or drill-through |
| One-time disclosure | 85 | Non-dismissible dialog, explicit warning, clipboard fallback. −15: it is still a password in a browser (see §0) |
| Welcome flow | 88 | Correct ordering, refresh-safe, server gate untouched. −12: sessionStorage flag is per-browser-session |
| UI | 86 | Badges, timeline, confirmations, toasts throughout. −14: no error boundary; history dialog unvirtualised |
| Security | 88 | All Feature 13 requirements met and grep-verified. −12: inherited token weaknesses |
| **Testing** | **35** | 41 tests still pass, but **nothing new here is covered** and none of it has been run against a real database or browser |

### **MODULE SCORE: 84 / 100**

### 8.2 Project-level movement

| Category | Before this module | After |
|---|---|---|
| Database | 78 | **80** |
| Backend | 74 | **78** |
| Frontend | 72 | **75** |
| Security | 72 | **76** |
| Observability | 30 | **48** (a real audit trail now exists) |
| Maintainability | 58 | **60** |
| Testing & CI | 40 | **40** (unchanged — this is the gap) |

**Estimated overall: 71 → 75 / 100.**

### 8.3 Ship / hold

**Ready** once §3 is applied and §6.2 passes: delivery tracking, admin notification, copy-credentials, welcome screen, badges, resend guidance, reset, history, deactivation with reason, dashboard.

**Hold for follow-up:**

1. **Automatic credential-email retry.** Still the biggest gap in the whole enrollment story. This module makes failure *visible* and *manually fixable*; it does not make delivery reliable. An `EmailOutbox` plus the job runner the project already needs would close it.
2. **Tests for `CredentialService` and `EnrollmentHistoryService.`** Both are pure-ish orchestration over Prisma and would test well against a test database or a Prisma mock. Their absence is why Testing did not move.
3. **History pagination.** Capped at 100 events with no "load more". Fine for a year; not forever.
4. **Audit retention.** `EnrollmentEvent` grows without bound and nothing prunes it.

### 8.4 Honest limitations

- **Nothing has been run.** No migration applied, no request issued, no page rendered. Every behavioural claim comes from source plus a clean typecheck/build/test run. §6.2 exists because that gap is real.
- **Resend Credentials is, by design, a signpost rather than an action.** If you would prefer it to silently perform a reset, that is a one-line change — but the current behaviour is what your brief asked for and is the more honest of the two.
- **The one-time disclosure is a deliberate security trade** (§0). It is the standard pattern and it is the only thing that makes a failed credential email recoverable without a second reset — but it does put a plaintext password in a browser tab, and you should agree with that explicitly rather than inherit it.
- **`firstLoginAt` is an extra column** beyond your specified list, added so the First Login event costs one write per account instead of a query on every login.
