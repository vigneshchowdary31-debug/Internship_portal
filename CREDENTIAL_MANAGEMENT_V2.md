# Enrollment & Credential Management — Polish Pass

**Project:** Student Training Portal
**Date:** 31 July 2026
**Scope:** Refinement of the existing credential module. Nothing was redesigned; no functionality was removed.
**Builds on:** [CREDENTIAL_MANAGEMENT.md](CREDENTIAL_MANAGEMENT.md) → [ENROLLMENT_SYSTEM.md](ENROLLMENT_SYSTEM.md)

**Verification**

| Check | Result |
|---|---|
| `backend` — `npm run typecheck` (build + test configs) | ✅ 0 errors |
| `backend` — `npm test` | ✅ **126 passed / 7 files** |
| `backend` — `tsc` build, no specs emitted to `dist/` | ✅ 0 test files |
| `frontend` — `tsc --noEmit` | ✅ 0 errors |
| `frontend` — `npm test` | ✅ **25 passed / 1 file** |
| `frontend` — `vite build` | ✅ 393 ms, 0 warnings |
| `frontend` — `oxlint` | ✅ 0 errors |
| **Total automated tests** | **151** (was 41) |
| Migration applied to a database | ⛔ **Not applied — DB still unreachable** |
| Runtime / browser testing | ⛔ **Not performed** |

---

## 0. ONE INSTRUCTION I COULD NOT FOLLOW AS WRITTEN

> **Feature 5:** *"Generate a small PDF using the officially supported reportlab library."*

**reportlab is a Python library.** This project is Node/TypeScript on the backend and React/TypeScript on the frontend — there is no Python runtime anywhere in it. reportlab cannot be installed or called here.

I did not substitute silently. What I built instead, and why:

**The PDF is generated in the browser, with no library.**

The security reasoning drove this more than the language mismatch. The plaintext password is already in the page — it arrived in the enrollment response. Generating the document client-side means it is **never transmitted a second time**. A server-side generator (pdfkit, or a Python service running reportlab) would require POSTing the password back to the server, which is strictly worse for a value whose entire security model is "it exists in exactly one place, briefly."

Given client-side generation, the options were `jspdf` (~350 kB) or hand-writing the format. A text-only PDF is a well-specified ~150 lines, so [credential-pdf.ts](frontend/src/lib/credential-pdf.ts) writes PDF 1.4 directly: no dependency on a credential-handling path, no bundle cost, full control. It uses the Helvetica base-14 fonts that every conforming reader supplies, so nothing is embedded.

**It is covered by 25 tests** asserting header/EOF markers, catalog and page-tree objects, xref offsets pointing at the real table, declared stream length matching the actual stream, escaping of `(`, `)` and `\`, and structural survival under adversarial input like `)) endstream endobj trailer <<`.

**If you want reportlab specifically**, that means standing up a Python service, sending it the password, and accepting that second transmission. Say the word and I will — but I would not choose it.

---

## 1. FILES CHANGED

### Backend

```
prisma/schema.prisma                                CHANGED  RESET_SENT, CREDENTIAL_GENERATED
prisma/migrations/20260731000300_credential_reset_flow/  NEW  enum extension
src/services/credential.service.ts                  CHANGED  resetCredentials() replaces
                                                             resendCredentials()+resetPassword();
                                                             new stats shape
src/services/enrollment-history.service.ts          CHANGED  EVENT_META adds icon + new label
src/services/user.service.ts                        CHANGED  records CREDENTIAL_GENERATED
src/controllers/user.controller.ts                  CHANGED  resetAndSendCredentials + resetPassword
src/routes/user.routes.ts                           CHANGED  renamed route + deprecated alias
tsconfig.json                                       CHANGED  excludes specs from the build
tsconfig.test.json                                  NEW      type-checks specs (ESM)
package.json                                        CHANGED  `typecheck` script

src/test/prismaMock.ts                              NEW      in-memory Prisma double
src/services/credential.service.test.ts             NEW      29 tests
src/services/enrollment.test.ts                     NEW      30 tests
src/services/auth.service.test.ts                   NEW      26 tests
```

### Frontend

```
src/lib/credential-pdf.ts                           NEW      dependency-free PDF writer
src/lib/credential-pdf.test.ts                      NEW      25 tests
src/components/users/CredentialsDialog.tsx          CHANGED  status rows + Download
src/components/users/CredentialBadge.tsx            CHANGED  RESET_SENT variant
src/components/users/CredentialDashboardCards.tsx   CHANGED  5 click-through cards
src/components/users/EnrollmentHistoryDialog.tsx    CHANGED  per-event icons
src/components/users/UserTable.tsx                  CHANGED  renamed + split reset actions
src/components/users/UserManagementPage.tsx         CHANGED  one reset mutation, ?view= filters
vitest.config.ts                                    NEW
package.json                                        CHANGED  vitest devDependency + scripts
```

**Removed:** nothing. The old `/resend-credentials` route still exists as a deprecated alias.

---

## 2. DATABASE CHANGES

`20260731000300_credential_reset_flow/migration.sql` — purely additive, no column altered, no row rewritten:

```sql
ALTER TYPE "CredentialStatus"     ADD VALUE 'RESET_SENT';
ALTER TYPE "EnrollmentEventType"  ADD VALUE 'CREDENTIAL_GENERATED';
```

| Decision | Reason |
|---|---|
| `RESET_SENT` rather than reusing `SENT` | Both mean delivered, but only one means *the user's previous password stopped working*. That is exactly the fact an admin needs when reading the table. |
| `CREDENTIAL_GENERATED` as its own event | "The account exists" and "a credential was minted" are separate facts. A reset produces `CREDENTIAL_GENERATED` again without a second `ENROLLED`, so the timeline reads correctly either way. |
| `CREDENTIAL_RESEND_BLOCKED` **kept**, marked deprecated | PostgreSQL cannot drop an enum value that rows may reference. Removing it would break any database where the previous migration is already applied. It is no longer written; the timeline labels it "(legacy)". |
| No backfill | Nothing changes meaning for existing rows. |

**Transaction note (in the migration file):** `ALTER TYPE ... ADD VALUE` runs inside a transaction on PostgreSQL 12+, but the new value cannot be *used* in that same transaction. This migration only declares the values, so there is no conflict. Supabase runs PG 15+.

---

## 3. API CHANGES

### 3.1 Reset endpoints

| Method | Route | Emails? | Purpose |
|---|---|---|---|
| `POST` | `/api/users/:id/reset-and-send-credentials` | ✅ | **Reset & Send New Credentials** |
| `POST` | `/api/users/:id/reset-password` | ❌ | **Reset Password** — manual handover |
| `POST` | `/api/users/:id/resend-credentials` | ✅ | **Deprecated alias** → same handler as the first |

Both return `200`:

```jsonc
{
  "success": true,
  "data": {
    "user": { /* full public record */ },
    "temporaryPassword": "Kf7#mQra2Xvz",   // one-time disclosure
    "emailed": true,                        // false for reset-password
    "credentialDelivered": true,
    "credentialFailureReason": null
  },
  "message": "New credentials generated and emailed."
}
```

**The 409 workflow is gone.** `/resend-credentials` previously returned `409 { requiresPasswordReset: true }` and refused. It now performs the reset it always should have — so any client still calling it keeps working *and* gets better behaviour rather than a dead end. That is the backward-compatible way to retire a bad name.

### 3.2 `GET /api/users/credential-status` — new shape

```jsonc
{
  "awaitingFirstLogin": 4,        // active, never signed in
  "awaitingPasswordChange": 8,    // active, still on a temporary password
  "failed": 3,                    // credentialStatus = FAILED
  "recentlyEnrolledCount": 12,    // last 7 days
  "inactive": 2,                  // deactivated
  "recentlyEnrolled": [ /* ≤10 */ ],
  "failures":         [ /* ≤20 */ ],
  "sent": 42,                     // retained; now spans SENT + RESET_SENT
  "pending": 5                    // retained
}
```

`sent` and `pending` are kept so nothing that already reads them breaks. `sent` deliberately counts **both** `SENT` and `RESET_SENT` — to a reader of that number, "the credential reached them" is the same fact either way.

### 3.3 Unchanged

Every other endpoint, including enrollment, CSV import/export, filters, login, change-password and enrollment history, is untouched apart from `enrollment-history` gaining an `icon` field per event (additive).

---

## 4. UI IMPROVEMENTS

### 4.1 Credential success dialog

```
┌────────────────────────────────────────────────┐
│ ✓ Student Enrolled Successfully                │
│ The account is ready to use.                   │
├────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────┐ │
│ │ 👤 Account created                         │ │ ← two independent facts,
│ └────────────────────────────────────────────┘ │   reported separately
│ ┌────────────────────────────────────────────┐ │
│ │ ✉ Credential delivery: Delivered           │ │
│ │   Sent to ravi.kumar@example.com            │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│  …or, on failure:                              │
│ ┌────────────────────────────────────────────┐ │
│ │ ✉ Credential delivery: Email delivery      │ │
│ │   failed — SMTP unreachable (TIMEOUT)      │ │
│ └────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────┐ │
│ │ ⚠ Please manually share these credentials  │ │
│ │   with the student.                        │ │
│ └────────────────────────────────────────────┘ │
├────────────────────────────────────────────────┤
│ Email               ravi.kumar@example.com     │
│ Temporary Password  Kf7#mQra2Xvz               │
│ Portal URL          https://portal.example.com │
├────────────────────────────────────────────────┤
│ 🛡 This password is shown only once…           │
│                                                │
│  [Copy Credentials] [Download Credentials] [Done]
└────────────────────────────────────────────────┘
```

A third state exists that the brief did not anticipate: **Reset Password sends no email at all**, so claiming "delivery failed" would be wrong. That renders as a neutral "No email sent — you chose to share these credentials manually."

Escape and click-outside remain disabled: closing destroys the only copy.

### 4.2 Downloaded PDF

```
┌────────────────────────────────────────────┐
│ ████████████████████ (indigo rule)         │
│ Internship Training Portal                 │
│ Student Login Credentials                  │
│                                            │
│ Name                                       │
│ Ravi Kumar                                 │
│ Email                                      │
│ ravi.kumar@example.com                     │
│ Temporary Password                         │
│ Kf7#mQra2Xvz                               │
│ Portal URL                                 │
│ https://portal.example.com                 │
│ Generated                                  │
│ 31 Jul 2026 14:30                          │
│                                            │
│ Security Note                              │
│ This temporary password is shown only once.│
│ Delete this document after securely        │
│ sharing it.                                │
│ The recipient must change this password at │
│ first login.                               │
└────────────────────────────────────────────┘
```

Filename: `credentials-ravi-kumar-2026-07-31.pdf`. The object URL is revoked immediately after the click, so the blob is released as the download starts.

### 4.3 Dashboard — five actionable cards

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Awaiting     │ Awaiting     │ Credential   │ Recently     │ Inactive     │
│ First Login ⇥│ Password  ⇥  │ Delivery  ⇥  │ Enrolled  ⇥  │ Accounts  ⇥  │
│ 4            │ Change  8    │ Failures  3  │ 12           │ 2            │
│ Enrolled but │ Still on a   │ Email never  │ In the last  │ Deactivated, │
│ never signed │ temporary    │ reached them │ 7 days       │ cannot log in│
│ in        →  │ password  →  │           →  │           → │           →  │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

Every card is a link to `/admin/students?view=<name>`. The named views live in `UserManagementPage`, and the card imports the `UserView` type from it — so a card and the table it links to **cannot** drift apart about what "awaiting first login" means. The filtered table shows a dismissible banner naming the active view.

### 4.4 Timeline with icons

```
 ⊕ Account created              31 Jul, 09:01
 🔑 Credential generated         31 Jul, 09:01
 ✉ Credential delivery failed   31 Jul, 09:02   ← red
 ↺ Password reset by admin      31 Jul, 09:15
 ✉ Credential delivered         31 Jul, 09:15   ← green
 ⇥ First login                  31 Jul, 10:20
 🛡 Password changed by user     31 Jul, 10:22
```

The server sends a **semantic icon key** (`mail-x`, `rotate-ccw`…), not a component name, so swapping icon libraries is a change to one map in the frontend.

### 4.5 Actions menu

```
  👁  View
  ✏️  Edit Details
  ─────────────────────────────────
  ✉+ Reset & Send New Credentials    ← renamed from "Resend Credentials"
  🔑  Reset Password (no email)       ← Feature 10, option 1
  🕐  Enrollment History
  ─────────────────────────────────
  ⏻  Deactivate / Activate
```

The old "Resend Credentials" item was disabled once a user set their own password. Both new actions are **always** available — resetting a password is legitimate at any point in an account's life, which is precisely what the old naming obscured.

---

## 5. CREDENTIAL LIFECYCLE

```
ADMIN ENROLLS
     │
     ├─ PasswordGeneratorService.generate()      12–16 chars, CSPRNG
     ├─ bcrypt.hash(cost 10)  ────────────────►  stored
     ├─ plaintext ──────────────────────────────► returned ONCE, then dropped
     │
     ├─ audit: ENROLLED, CREDENTIAL_GENERATED
     └─ credentialStatus = PENDING
              │
              ▼
        EMAIL ATTEMPT  (SMTP → Gmail API fallback)
              │
      ┌───────┴────────┐
      ▼                ▼
  delivered        failed
  status=SENT      status=FAILED + reason + retryCount++
  audit:           audit: CREDENTIAL_FAILED
  CREDENTIAL_SENT  dashboard: "Credential Delivery Failures"
      │                │
      └────────┬───────┘
               ▼
     Credentials dialog — one-time disclosure
     [Copy] [Download PDF] [Done]      ← the recovery path when email failed
               │
               ▼
     USER LOGS IN  → firstLoginAt stamped, audit: FIRST_LOGIN
               │
               ▼
     /welcome → Continue → /change-password
               │
               ▼
     mustChangePassword = false
     passwordChangedAt  = now
     audit: PASSWORD_CHANGED
               │
               ▼
            ACTIVE
```

### Reset branch

```
ACTIVE (or stuck anywhere above)
    │
    ├─ "Reset & Send New Credentials"      ├─ "Reset Password"
    │      sendEmail: true                 │      sendEmail: false
    ▼                                      ▼
  generate → hash → store                generate → hash → store
  mustChangePassword = true              mustChangePassword = true
  passwordChangedAt  = null              passwordChangedAt  = null
  status → PENDING                       status → PENDING  (stays PENDING —
    │                                                       delivery is manual)
    ▼                                      │
  email → status = RESET_SENT              │
          or FAILED + reason               │
    │                                      │
    └──────────────┬───────────────────────┘
                   ▼
        Credentials dialog — one-time disclosure
                   ▼
        USER LOGS IN → /welcome → /change-password → ACTIVE
```

---

## 6. STATE MACHINE

### `credentialStatus`

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
              ┌─────▼─────┐  email ok    ┌──────┐             │
  enroll ────►│  PENDING  ├─────────────►│ SENT │             │
              └─────┬─────┘              └──┬───┘             │
                    │                       │                 │
                    │ email fails           │                 │
                    ▼                       │                 │
              ┌──────────┐                  │                 │
              │  FAILED  │                  │                 │
              └────┬─────┘                  │                 │
                   │                        │                 │
                   │   ┌────────────────────┘                 │
                   ▼   ▼                                      │
            reset (sendEmail: true) ──► PENDING ──► RESET_SENT┤
                                                      │       │
            reset (sendEmail: false) ─► PENDING ──────┘       │
                                          │                   │
                                          └───────────────────┘
                                       (further resets re-enter)
```

**Invariants, each covered by a test:**

| Invariant | Test |
|---|---|
| Enrollment delivery → `SENT`, never `RESET_SENT` | `marks an original enrollment delivery as SENT` |
| Reset delivery → `RESET_SENT`, never `SENT` | `marks a re-issued delivery as RESET_SENT, not SENT` |
| A reset always passes through `PENDING` first | `transitions PENDING then RESET_SENT, in that order` |
| Reset-without-email terminates at `PENDING` | `reports emailed:false and leaves status PENDING` |
| `retryCount` increments only on a retry | `increments the retry counter only on a retry` |
| Every failure carries a reason | `substitutes a reason when the transport did not supply one` |

### Account access

```
   ENROLLED ──► mustChangePassword=true ──► FIRST_LOGIN ──► PASSWORD_CHANGED ──► ACTIVE
                          ▲                                                        │
                          └──────────────── reset ─────────────────────────────────┘

   ACTIVE ⇄ INACTIVE      (deactivate / activate, both audited with an optional reason)
```

---

## 7. TEST RESULTS

```
BACKEND   7 files   126 tests   ✅
  src/utils/csv.test.ts                      20   RFC 4180 parser
  src/utils/jwt.test.ts                       2   pre-existing
  src/utils/AppError.test.ts                  2   pre-existing
  src/services/password.service.test.ts      15   generation + policy
  src/services/credential.service.test.ts    29   NEW
  src/services/enrollment.test.ts            30   NEW
  src/services/auth.service.test.ts          26   NEW

FRONTEND  1 file     25 tests   ✅
  src/lib/credential-pdf.test.ts             25   NEW

TOTAL                151 tests  (was 41)
```

### Coverage against Feature 12

| Required | Covered by |
|---|---|
| Enrollment success | `enrollUser — success` (7 tests) |
| Enrollment email failure | `still succeeds when delivery fails…`, `records a failure with its reason…` |
| One-time password disclosure | `returns the plaintext password exactly once`, `never persists the plaintext password`, `never selects the password column back out` |
| Credential reset | `resetCredentials` — shared / with email / without email (17 tests) |
| Credential status transitions | 6 invariant tests listed in §6 |
| Welcome flow | `login` returns `mustChangePassword`; `firstLoginAt` stamped once; allowlist gate (11 tests) |
| Password change flow | `changePassword` (6 tests) |
| Enrollment history creation | `EnrollmentHistoryService` (7 tests) + event assertions throughout |
| Credential download | `credential-pdf.test.ts` (25 tests) |
| Credential dashboard | `getCredentialStats` (2 tests) |

### Testing infrastructure notes

- [`src/test/prismaMock.ts`](backend/src/test/prismaMock.ts) is a shallow in-memory double. `where` clauses are **not** evaluated — each test sets the return it needs. Anything genuinely depending on query semantics (`buildWhere`) is tested by asserting the *clause that gets built*, not by executing it. That boundary is deliberate and stated in the file.
- Specs are excluded from `tsconfig.json` so they are never emitted into `dist/`; `tsconfig.test.json` type-checks them under ESM (they use top-level `await` for `vi.mock` ordering). `npm run typecheck` runs both.
- This also fixed a latent problem: the build previously emitted `.test.js` into `dist/`. Now zero.

**Still not covered:** HTTP-level integration (supertest), and any browser interaction. Both need infrastructure that does not exist here yet.

---

## 8. MIGRATION NOTES

Migration chain, unchanged procedure from [ENROLLMENT_SYSTEM.md §7](ENROLLMENT_SYSTEM.md):

```
20260731000000_baseline               ← mark applied on an existing DB
20260731000100_enrollment_fields
20260731000200_credential_management
20260731000300_credential_reset_flow  ← new
```

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

**This migration is the lowest-risk one so far** — two enum additions, no data touched, nothing to backfill, no lock beyond a brief catalog update.

Verify:

```sql
SELECT unnest(enum_range(NULL::"CredentialStatus"));     -- PENDING SENT FAILED RESET_SENT
SELECT unnest(enum_range(NULL::"EnrollmentEventType"));  -- 11 values incl. CREDENTIAL_GENERATED
```

**Rollback:** PostgreSQL cannot drop an enum value. To revert you would need to recreate the type, which is why the deprecated value was kept rather than removed. In practice: deploy the previous application build; the unused enum values are inert.

**Deployment order matters.** Deploy the migration *before* the application, because the new code writes `RESET_SENT` and `CREDENTIAL_GENERATED`. Reverse the order and those writes fail until the migration lands. The existing Render build command already does this.

---

## 9. SECURITY REVIEW

| Requirement | Implementation | Verified by |
|---|---|---|
| Never persist plaintext passwords | Generate → hash → return → drop | `never persists the plaintext password` asserts the written value is the hash, not the plaintext |
| Never log passwords | No `console.*` references any password variable | grep, re-run this pass |
| Never expose after one-time disclosure | Returned only in create/reset responses; `USER_PUBLIC_SELECT` has no `password` | `never selects the password column back out` |
| PDFs exist only temporarily | Built in memory, object URL revoked immediately after click | `generates entirely in memory — nothing is written or fetched` |
| Downloads not reproducible later | Builder is a pure function of the password, which is gone once the dialog closes. No endpoint regenerates it | Design; enforced by the same no-persistence rule |
| All resets audited | `PASSWORD_RESET` + `CREDENTIAL_GENERATED` on every path, both attributed to the acting admin | `audits the reset and the generation`, `attributes the audit events to the acting admin` |

### Additional hardening carried forward

- Cannot reset a peer administrator's password (403) — tested both ways.
- Cannot deactivate your own account — tested.
- 30 credential actions / 15 min / IP.
- Audit `detail` truncated to 500 chars — tested.
- Audit writes never throw, so a failed log cannot roll back a completed reset — tested for both single and batch writes.
- The PDF embeds **no** `/Author`, `/Creator` or `/Producer` metadata — tested.

### Residual risks

1. **The one-time disclosure puts a plaintext password in a browser tab, and now also in a downloaded file.** The PDF is the sharper edge: unlike the dialog, it persists on disk until someone deletes it. The document says so in its own body, but that is a instruction, not a control. This is the unavoidable cost of making a failed credential email recoverable — accept it deliberately.
2. **`Reset Password` (no email) leaves `credentialStatus = PENDING`.** Semantically right — nothing was delivered by the system — but such a user sits in the "Pending Credentials" count until they log in. Correct, and possibly surprising.
3. **The deprecated `/resend-credentials` alias now performs a real reset.** A client that previously relied on getting a harmless 409 will now change a password. This is the intended fix, but it is a behaviour change on an existing route and is called out here rather than buried.

---

## 10. PRODUCTION READINESS

| Area | Before | After | Why |
|---|---|---|---|
| Credential lifecycle | 90 | **94** | `RESET_SENT` closes the one ambiguity in the model; every transition is now test-pinned |
| Admin UX | 87 | **93** | One-click reset instead of a 409 detour; five cards that navigate; honest naming |
| Credential disclosure | 85 | **90** | Separated account vs delivery status; PDF handout; handles the no-email case |
| Audit trail | 88 | **91** | `CREDENTIAL_GENERATED` + icons; timeline is now complete per Feature 8 |
| Dashboard | 88 | **93** | Every metric is actionable and cannot drift from the table it links to |
| **Testing** | **40** | **78** | 41 → 151 tests; the credential state machine is fully covered |
| Security | 88 | **89** | Same invariants, now enforced by tests rather than by grep |
| Code quality | 86 | **90** | One reset path instead of two; specs no longer pollute `dist/` |

### **FEATURE SCORE: 90 / 100** (was 84)

**Project estimate: 76 → 81 / 100.**

The largest single movement is testing, which was the stated gap at the end of the last pass and is now the strongest part of this module.

### What still holds it back

1. **No automatic email retry.** Still the biggest gap in the enrollment story. This module makes failure visible, recoverable and now downloadable — it does not make delivery reliable. An `EmailOutbox` plus the job runner the project already needs would close it.
2. **No HTTP integration tests.** Services are well covered; routes, middleware ordering and the password-change gate are only covered at the unit level. supertest against an in-memory app would close this cheaply.
3. **History pagination.** Capped at 100 with no "load more".
4. **Audit retention.** `EnrollmentEvent` grows without bound.

### Honest limitations

- **Nothing has been executed against a database or a browser.** 151 tests, two clean typechecks and a clean build are strong signals, but they are not the same as a running system. The migration remains unapplied.
- **The PDF has been validated structurally, not visually.** The tests prove it is a well-formed PDF 1.4 document with correct xref offsets and stream lengths; they cannot prove Acrobat renders it attractively. Open one before relying on it.
- **`reportlab` was not used and cannot be** (§0).
- **The Prisma mock does not evaluate `where` clauses.** Tests assert the clauses being built rather than the rows they would return, so a semantically wrong-but-well-formed query would pass. Integration tests are the fix.
