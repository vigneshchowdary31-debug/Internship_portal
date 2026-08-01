# PRODUCTION READINESS REPORT

**Project:** Student Training Portal
**Assessment date:** 31 July 2026
**Assessed at:** commit `2049678` plus two uncommitted working-tree changes (Google Calendar guest list)
**Method:** Full static reverse-engineering of every source file. Type-checking run read-only on both packages. No runtime testing against a live database or live Google APIs was performed.

**Companion documents:** [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) · [TECHNICAL_AUDIT.md](TECHNICAL_AUDIT.md) · [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md)

---

## ⚠️ CORRECTION TO EXISTING DOCUMENTATION

Two documents already in this repository state a **100/100** production readiness score:

- [DEPLOYMENT_REPORT.md](DEPLOYMENT_REPORT.md) — *"Production Readiness Score: 100/100"*, *"Remaining Issues: **None**"*
- [REPOSITORY_CLEANUP_REPORT.md](REPOSITORY_CLEANUP_REPORT.md) — *"Deployment Readiness Score: 100/100"*, *"Zero code changes are required to launch"*

Those documents are measuring **deployability** — will it build, will it boot, will the healthcheck pass. On that narrow question they are correct: `tsc --noEmit` passes cleanly on both packages (verified), the Vite build is configured correctly, the healthcheck endpoint works, and the environment variable templates are complete.

They are **not** measuring production readiness in the sense of "safe to operate with real users and real data." Against that standard the honest score is **62/100**. The gap is not in build tooling — it is in authorization, database change management, observability, and testing. Two specific claims in those documents are contradicted by the source:

- `DEPLOYMENT_CHECKLIST.md` asserts an error boundary exists in the frontend. **No React error boundary exists anywhere in the codebase.**
- `DEPLOYMENT_REPORT.md` states remaining issues are "None." Four High-severity authorization findings and one Critical database-management finding are documented below.

This report supersedes those scores.

---

## 1. SCORECARD

| # | Category | Score | Grade | One-line verdict |
|---|---|---|---|---|
| 1 | **Architecture** | **72** / 100 | C+ | Sound layering, correct failure-isolation instincts, undermined by two fat routers and zero DI |
| 2 | **Backend** | **68** / 100 | C+ | Clean services and error handling; 18 of 26 endpoints unvalidated, none paginated |
| 3 | **Frontend** | **65** / 100 | C | Modern stack, good empty states, code-split routes; no error boundary, silent mutation failures, pervasive `any` |
| 4 | **Database** | **55** / 100 | D+ | Well-normalised schema with correct FKs and indexes — **but no migration history at all** |
| 5 | **Authentication** | **74** / 100 | C+ | bcrypt, fail-fast secret, per-request revalidation; no refresh tokens, no revocation, a real `/auth/me` bug |
| 6 | **Authorization** | **45** / 100 | F | Role gates work. **Resource ownership checks do not exist.** Four High findings |
| 7 | **Scheduling** | **70** / 100 | C | Core flow is solid and instrumented; no conflict detection, no past-date guard, `COMPLETED` never set |
| 8 | **Google Integration** | **72** / 100 | C+ | Correct two-token design, mock mode, honest feasibility analysis; no retry, hard-coupled to session creation |
| 9 | **Email** | **85** / 100 | B | **The strongest subsystem here.** Dual transport, circuit breaker, real diagnostics. No retry, recipients leak |
| 10 | **Security** | **65** / 100 | C | No injection surface, correct secret hygiene; authorization gaps and no audit trail |
| 11 | **Performance** | **60** / 100 | D | No N+1 anywhere — genuinely good. Nothing is bounded; hard wall at ~2k records |
| 12 | **Maintainability** | **50** / 100 | D | Excellent naming and comments; near-zero tests, real duplication, accumulated dead code |
| 13 | **Observability** | **30** / 100 | F | 168 `console.*` calls. No structured logs, no APM, no alerting, no audit trail |
| 14 | **Testing & CI** | **10** / 100 | F | 2 trivial specs that **cannot run** — `npm test` is wired to fail. No CI |
| 15 | **Documentation** | **70** / 100 | C+ | Strong deployment docs and an outstanding feasibility analysis; no API docs, and two docs overstate readiness |

### **OVERALL: 62 / 100 — Grade D+**

**Verdict: a capable MVP that is deployable today but not yet safe to operate at scale.**

### How the overall was weighted

| Category | Weight | Contribution |
|---|---|---|
| Security + Authorization | 20 % | 11.0 |
| Backend + Architecture | 18 % | 12.6 |
| Database | 12 % | 6.6 |
| Testing & CI | 12 % | 1.2 |
| Frontend | 10 % | 6.5 |
| Observability | 8 % | 2.4 |
| Integrations (Google + Email) | 10 % | 7.9 |
| Performance | 6 % | 3.6 |
| Documentation | 4 % | 2.8 |
| | | **≈ 62** |

Testing and observability carry real weight because they determine whether the other categories can be *kept* healthy. A 62 with zero tests behaves worse over time than a 62 with good tests.

---

## 2. SCORE RATIONALE

### Why Email scores 85 — the outlier
[services/email/](backend/src/services/email/) is production-grade by any standard. Dual transport with the fallback restricted **only** to network-class failures, so an auth or TLS error surfaces instead of being masked. A circuit breaker so a firewalled port does not park a socket per message. Seven failure classifications each with an actionable remedy. Raw TCP egress probes at startup that distinguish "the platform blocks SMTP" from "this box has no network" from "the failure is above the network layer." Two independently scoped refresh tokens so the Calendar token is never re-scoped. Credentials logged only as character counts.

It loses 15 points for: no retry or persistence (one attempt, then the message is gone), all recipients on a single `To:` header, and dates formatted in the server's timezone with no label.

### Why Authorization scores 45 — the anchor
Everything else in security is fine. Prisma parameterises every query and there is **zero raw SQL** in the codebase. React escapes output and there is **no `dangerouslySetInnerHTML` anywhere**. Bearer-token auth means no CSRF surface. Secrets are correctly git-ignored and never printed.

But resource ownership is simply not modelled. Any instructor can retime, cancel, or delete any session by ID — including firing cancellation emails at another instructor's cohort. Any student can read any other student's attendance and progress record, including private instructor notes. Any authenticated user can pull a batch's full roster with every email address. These are four independent High findings caused by one missing layer.

### Why Database scores 55 despite good schema design
The schema itself is clean: 3NF, every FK indexed, composite uniques exactly where the upsert patterns need them, sensible cascades in most places. That work deserves credit.

It scores 55 because `backend/prisma/migrations/` is **git-ignored** ([.gitignore:34](.gitignore#L34)). The production schema cannot be reproduced from the repository, no schema change is reviewable, and there is no rollback path. Schema management is the part of a database you cannot bolt on later without pain, and it is absent.

### Why Testing scores 10
Two vitest specs exist, covering `AppError` and `jwt` — roughly 40 lines against the two most trivial utilities in the codebase. `npm test` is `echo "Error: no test specified" && exit 1`, so **they never run**. `SessionService`, `AttendanceService`, `ProgressService`, `UserService`, and `AuthService` have no tests at all. Business-logic coverage is effectively 0 %. The 10 points are for the specs existing and for vitest being installed.

---

## 3. FINAL VERDICT

### 3.1 What is already complete

These work end-to-end and need no further attention right now:

| | |
|---|---|
| **Email delivery subsystem** | Dual transport, circuit breaker, failure classification, startup diagnostics, refresh-token CLI. The best code in the repository |
| **Google Meet / Calendar happy path** | Event creation with conference data, guest list, update, delete, 10 s timeout, offline mock mode |
| **Login and JWT authentication** | bcrypt cost 10, generic failure messages, deactivated-account rejection, fail-fast on missing secret |
| **Role-based route gating** | `restrictTo` and the frontend `allowedRoles` guard, consistently applied |
| **Tech stack CRUD** | Including exemplary FK-violation handling |
| **Batch CRUD and assignment** | Transactional student/instructor assignment |
| **Session lifecycle** | Create / edit / cancel with Calendar sync and notification emails |
| **Attendance marking** | Idempotent upsert, four states, bulk roster UI, cancelled-session rejection |
| **Progress tracking** | Upsert, auto-derived level, instructor notes |
| **Three role dashboards** | Functional with good empty states |
| **Ops fundamentals** | Health checks, graceful shutdown, env fail-fast, global error handler, helmet/CORS/compression |
| **Deployment configuration** | Render + Vercel + Supabase, documented, and **verified to compile cleanly** |

### 3.2 What is partially complete

| Feature | What works | What is missing |
|---|---|---|
| Authorization | Role gates | **All ownership and resource scoping** |
| Session lifecycle | Create, edit, cancel | `COMPLETED` is never set; no conflict or past-date guard; `PATCH` runs unvalidated |
| Instructor experience | Dashboard, attendance, progress | **No UI to edit or cancel their own sessions** despite full API support |
| Admin reporting | Two report-shaped pages | No filters, no date range, no export, no pagination |
| Input validation | 8 endpoints with good schemas | 18 endpoints unvalidated — and `validate()` discards its own output, negating it globally |
| User management | Create, edit, activate/deactivate | No delete, no password reset, no welcome email, no bulk import |
| Session restore | Role survives refresh | **`name` and `email` do not** — the header renders `Hello, undefined` |
| Google integration | Full CRUD on events | No retry, no reconciliation; swallowed failures cause silent divergence |
| Email | Excellent transport layer | No retry, no queue, no persistence, no per-recipient isolation |
| Frontend feedback | 5 pages with inline errors | `alert()` on one page, **silence on the rest**; no error boundary |
| Testing | 2 utility specs | Everything else — and the specs cannot even run |

### 3.3 What should never be changed

Treat these as settled. Re-opening them wastes time and makes the system worse:

1. **The email transport-selection logic** ([email.service.ts:45-75](backend/src/services/email.service.ts#L45-L75)). Falling back only on network-class failures — and deliberately *not* on auth/TLS/recipient errors — is correct and unusual. Most implementations get this wrong. Add retry *around* it; do not restructure it.

2. **The two separate Google refresh tokens.** `GOOGLE_REFRESH_TOKEN` (calendar.events) and `GMAIL_REFRESH_TOKEN` (gmail.send) are separate because a refresh token is bound to the scopes it was granted. Merging them to "simplify configuration" would break Calendar the next time anyone re-consents for email.

3. **The Google Meet co-host conclusion.** [docs/google-meet-cohost-feasibility.md](docs/google-meet-cohost-feasibility.md) proves co-host and recording are blocked by an account-level licensing limit **and**, independently, an API-level limit — and that paying for Workspace fixes only the first. The analysis is rigorous, correctly sourced, and explicit about what it could not confirm. Do not re-investigate. Do not let anyone add simulated co-host behaviour.

4. **Fire-and-forget email in the session service.** `void EmailService.sendX(...).catch(...)` is deliberate: mail delivery must never fail a request or delay a response. Keep it.

5. **The env fail-fast split** ([env.ts](backend/src/config/env.ts)). Required vars exit the process; email vars only warn. That distinction is exactly right and should survive any config refactor.

6. **The `@@unique` constraints** on `(sessionId, studentId)` and `(studentId, techStackId)`. They are what make the idempotent upserts safe.

7. **The mock Google mode** ([google.service.ts:78-87](backend/src/services/google.service.ts#L78-L87)). Local development works fully offline because of it.

8. **The startup TCP egress probes.** They answer "is this our bug or the platform's?" in one boot log. Most teams never build this.

### 3.4 What needs immediate attention

In order. The first is not negotiable before the next schema change.

| Priority | Item | Effort | Why now |
|---|---|---|---|
| **1** | **Restore Prisma migration history** | S | The production schema is currently unreproducible and unrollbackable. Blocks every other DB item |
| **2** | **Fix `validate()` discarding its parsed output** | S | Two lines. Restores input sanitisation across every validated endpoint |
| **3** | **Add ownership authorization** | M | Instructors can currently mutate any session and email any cohort |
| **4** | **Close the mass-assignment hole** | S | `{"password":"x"}` writes plaintext and permanently locks the account out |
| **5** | **Scope student-record reads and batch rosters** | S | Students can read each other's records and email addresses |
| **6** | **Fix `GET /auth/me`** | S | Every logged-in user sees `Hello, undefined` after a refresh |
| **7** | **Wire `npm test` and cover the service layer** | M | Every fix above is currently unverifiable |
| **8** | **Add structured logging** | M | Production problems are presently undiagnosable |
| **9** | **Remove the Google hard-dependency on session creation** | S | A Google outage blocks all scheduling |
| **10** | **Untrack `dist/`, remove the `verify-*.ts` scripts** | S | Those scripts write to the live database and create real Calendar events |
| **11** | ⏳ **Add a progress-history table** | S | **Historical progress data is being overwritten and lost every day this waits** |

Items 1–6 and 9–11 are all **S** — roughly one focused week closes every Critical and High finding except testing and logging.

### 3.5 What should be built next

After the list above, in dependency order:

1. **Pagination and filtering** on the four unbounded list endpoints. The hard wall is ~1,000–2,000 attendance records — one 30-student cohort reaches that in about 50 sessions.
2. **A background job runner.** Nothing schedules anything today. This one piece of infrastructure unblocks four separate features. ⚠️ Requires deciding the Render plan first — free instances sleep, so an in-process scheduler will not fire reliably.
3. **Session auto-completion.** `COMPLETED` already exists in the enum, the validator, and two UI badges, and is never written. Dead UI today.
4. **Email outbox with retry**, then **reminder emails**. Reminders are the highest-value use of infrastructure that already exists and sits idle between sessions — but without retry, a missed reminder is silently lost, so sequence the outbox first.
5. **Instructor session management UI.** The API already supports it; no screen calls it. Near-zero new code — but ownership checks must land first.
6. **Password reset.** Currently a locked-out user needs admin intervention, and the admin's only tool corrupts the account.
7. **Toasts and an error boundary.** Users currently lose work silently on several pages.
8. **Fix email recipient privacy and timezone labelling.** Every student sees every classmate's address; times are UTC with no label.

### 3.6 What should wait until version 2

| Item | Why it waits |
|---|---|
| **Recurring sessions** | Needs conflict detection, RRULE handling, and named-timezone Calendar events (current payload is UTC-offset-only and would drift across DST). Genuinely hard; do it properly or not at all |
| **Per-instructor Google identity (option 8b)** | The only path to real Meet host powers, but it relaxes the shared-account constraint and carries a 7-day refresh-token expiry risk on unverified consent screens. It is a **product decision**, not an engineering one — and the feasibility doc is explicit that free-account host powers were never empirically confirmed |
| **Assignments, submissions, grading** | A different product. Validate demand before committing to XL scope |
| **File and resource sharing** | Needs object storage, upload validation, and virus scanning — none of which exist |
| **Certificates** | Depends on batch lifecycle (batches have no dates or status today) |
| **Real-time updates** | Solves a problem nobody has demonstrated at this scale |
| **Mobile app / PWA** | Needs a stable, documented API contract first |
| **Multi-tenancy** | ⚠️ **The one item where waiting is genuinely expensive.** Retrofitting tenant scoping onto a populated schema is the hardest change on the list. If there is any chance this serves a second organisation, decide **now**, not in v2 |
| **Meet recording management** | **Never** — blocked upstream. Paid entitlement, and no public start/stop API at any tier |

---

## 4. GO / NO-GO

### Can this go to production today?

**For a small internal pilot — yes, with conditions.**
The core flows work, it compiles cleanly, and it deploys. The authorization gaps are the deciding factor: within a small, trusted, single-organisation cohort where instructors and students are known colleagues, an instructor being *able* to cancel another's session is a governance problem rather than an attack. Conditions:

- Change the seeded `admin@example.com` / `admin123` credentials before first boot.
- Set `CORS_ORIGIN` explicitly — the fallback is `origin: '*'`.
- Accept that a failed notification email is permanently lost with no record.
- Accept that nothing is paginated and reporting pages will slow noticeably past a few hundred records.
- Do not run `verify-attendance.ts` or `verify-session-actions.ts` against production — they write real data and create real Calendar events.

### **For anything beyond a trusted pilot — not yet.**

Blocking items, in order:

1. **No migration history.** The schema cannot be safely evolved or rolled back. This alone should block a real launch.
2. **Four High authorization findings.** Cross-instructor session mutation and cross-student record access are not acceptable outside a trusted group.
3. **No pagination.** A predictable, dated failure — not a hypothetical one.
4. **No observability.** When something breaks, there is no way to find out what.
5. **No tests.** Every fix carries unbounded regression risk.

**Realistic timeline to a defensible production launch: 3–4 weeks of focused work** — the entirety of Phase 1 plus items 2.1 and 2.2 from [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md).

---

## 5. CLOSING ASSESSMENT

This codebase has an unusual shape: **one subsystem is markedly better engineered than the rest of the application around it.**

The email layer, the Google feasibility analysis, and the failure-isolation philosophy show real engineering judgement — the kind that comes from having been burned in production and having thought carefully about what must never fail. The nodemailer IPv6 workaround, the circuit breaker, the restricted fallback condition, the raw TCP egress probes, the two-token scope separation: none of that is obvious, and all of it is right.

The CRUD surface around it was built fast and shows it. `// For MVP...` comments mark shortcuts nobody returned to. Two routers absorbed business logic that belonged in services. A repository layer was started and abandoned as an empty directory. Two implementations of session creation ship side by side. The middleware meant to sanitise input silently does nothing. Tests were written for the two easiest utilities and then wired to a script that fails on purpose.

None of this is unusual for a product at this stage, and none of it is hard to fix — **items 1–6 and 9–11 of §3.4 are all under a day each.** What matters is that the strong parts are genuinely strong and should be protected, while the weak parts are weak in specific, well-understood, bounded ways rather than diffusely.

The single most consequential finding is not a bug: it is that **`backend/prisma/migrations/` is git-ignored**. Everything else on this list can be fixed at any time. Schema management gets harder every day it is deferred, and it is the one thing that should be fixed before the next line of feature code is written.

---

*This report is based entirely on static analysis of the source at commit `2049678`. No runtime behaviour was observed against a live database or live Google APIs. Findings marked UNVERIFIED in the companion documents are inferred from source and should be confirmed empirically before being acted on.*
