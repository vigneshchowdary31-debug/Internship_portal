# Technical Feasibility Report: Automatic Google Meet Co-Host Assignment

**Question:** Can an instructor automatically become a *true* Google Meet co-host using only Google Calendar API / Google Meet API / Gmail API / OAuth, while the backend keeps using a single **personal (free) Gmail** account (`vigneshchowdary31@gmail.com`) as the meeting organizer?

**Verdict: NO. This is not possible.** It is blocked by **two independent limitations** — one account-level, one API-level. Either one alone would be fatal; both apply.

No fake or placeholder co-host logic has been added to the codebase.

---

## 1. Summary table

| Requirement | Achievable on free Gmail + public APIs? | Blocker |
|---|---|---|
| Instructor joins before students | **Yes** | None — implemented (Calendar guest list) |
| Instructor shares screen | **Yes** | None — open to all participants when Host Management is unavailable |
| Instructor becomes true co-host | **No** | Account limitation **and** API limitation |
| Instructor admits participants | **No** | Host-only; on personal-account meetings only the creator can admit |
| Instructor removes participants | **No** | Requires Host Management (paid editions) |
| Instructor ends meeting for everyone | **No** | Requires Host Management (paid editions) |
| Meeting is recorded | **No** | Recording is a paid entitlement; also **no public API to start/stop recording at all** |

---

## 2. Task-by-task findings

### Task 1 — Does any public Google API support assigning Meet co-hosts?

**Only one, and it is not generally available.** The Meet REST API **v2beta** exposes a
`spaces.members` sub-resource whose `Role` enum includes `COHOST`, described as giving
"the same abilities to manage the meeting as the meeting organizer."

Two hard gates:

1. It is **Developer Preview only** — Google's own page states `spaces.members` is
   "available as part of the Google Workspace Developer Preview Program."
2. **The Developer Preview Program cannot be joined with a `gmail.com` account.**
   Enrollment requires an email address in a Google Workspace domain.

There is **no co-host capability in the generally available Meet REST API v2**.

### Task 2 — Can Calendar event attendees automatically become Meet co-hosts?

**No.** The Calendar API `Events` resource `attendees[]` object has exactly these fields:
`id`, `email`, `displayName`, `organizer`, `self`, `resource`, `optional`,
`responseStatus`, `comment`, `additionalGuests`.

There is **no role, host, co-host, or moderator field**. `organizer: true` is an
*output-only* marker identifying the event creator — it is not writable and it does not
confer Meet host rights on anyone else.

Note the asymmetry: the Google **Calendar UI** *can* set co-hosts (Video call options →
Host management → Co-hosts). That setting is **not exposed through the Calendar API** —
it lives in Meet's internal conference configuration, not in the API's event schema. So
even a Workspace customer cannot script the thing they can click.

### Task 3 — Does Meet ConferenceData support host assignments?

**No.** `conferenceData` contains only: `createRequest`, `entryPoints`,
`conferenceSolution`, `conferenceId`, `signature`, `notes`. Every one of these is either
connection metadata (URIs, dial-in numbers, meeting code) or provisioning bookkeeping.
There is no host, co-host, moderation, or access-control field anywhere in the object.

### Task 4 — Does any Meet REST API expose host controls?

**Not the ones required.** Generally available Meet REST API v2 surface:

- `spaces.create`, `spaces.get`, `spaces.patch`, `spaces.endActiveConference`
- `SpaceConfig`: `accessType`, `entryPointAccess`, `moderation`,
  `moderationRestrictions` (`chatRestriction`, `reactionRestriction`,
  `presentRestriction`, `defaultJoinAsViewerType`), `attendanceReportGenerationType`,
  `artifactConfig`
- `conferenceRecords.*` — read-only *retrieval* of recordings, transcripts, participants

Critically:

- These configure the **space**, not **who holds host rights**. There is no
  "make this user a host" operation in v2.
- `endActiveConference` is a server-side call by the *authenticated organizer account* —
  it is not "instructor ends meeting for everyone" from inside the client.
- `artifactConfig` can request auto-recording but **cannot be used here** (see Task 6).
- **The Meet REST API is Workspace-only.** Google's Node.js quickstart lists as a
  prerequisite, verbatim: *"A Google Workspace account with Google Meet enabled."* The
  shared `gmail.com` backend account cannot call this API at all.

### Task 5 — Is Google Workspace mandatory?

**Yes, for every one of the co-host requirements.** Google's co-host support page lists
the eligible editions explicitly: Business Standard, Business Plus, Essentials,
Enterprise Starter/Essentials/Standard/Plus, all Education editions, and Workspace
Individual (up to 25 co-hosts).

**Free personal Google Accounts are not on that list.** Co-host does not exist on a free
account even as a manual, human, in-UI action. There is therefore nothing to automate —
this is not "the API is missing a feature," it is "the product feature is not licensed to
this account."

### Task 6 — Is recording available on personal Gmail?

**No, on a free account.** Native Meet cloud recording requires one of:

- Google Workspace **Business Standard or higher** (Business Starter excluded)
- **Google Workspace Individual**
- **Google One Premium 2 TB or above** / Google AI Pro / AI Ultra

A free `gmail.com` account does not show a Record button at all.

**And separately — there is no public API to start or stop a recording.** Even on a
qualifying Workspace edition, recording is initiated by a human in the Meet client, or
automatically via `SpaceConfig.artifactConfig` (Meet API — Workspace-only). The Meet API's
`conferenceRecords.recordings` endpoints only *read artifacts after the fact*. So
"automatically record the meeting" is blocked by an **account limitation and an API
limitation simultaneously**.

### Task 7 — Exact classification of the limitations

| # | Limitation | Type | Blocks |
|---|---|---|---|
| A | Co-host / Host Management is a paid-edition entitlement; free personal accounts do not have it | **Account limitation** (product licensing) | co-host, admit, remove, end-for-all |
| B | Neither Calendar API `conferenceData`/`attendees` nor Meet REST API v2 has any host-assignment field or method | **API limitation** | co-host on *any* account, including Workspace |
| C | Meet REST API requires a Google Workspace account | **Account limitation** | all Meet API usage from this backend |
| D | `spaces.members` + `COHOST` exists only in Developer Preview, and DPP cannot be joined with a `gmail.com` address | **Both** — preview-gated API, Workspace-gated enrollment | the one API that could do it |
| E | Recording requires a paid tier **and** has no public start/stop API | **Both** | recording |

The single most important consequence: **blocker B means this is not solvable by
upgrading alone.** Even paying for Google Workspace Business Standard would give you
co-hosts *in the Calendar UI*, set by hand, per meeting — not programmatically. Automating
it would still require Developer Preview access to `spaces.members`.

### Task 8 — Officially supported workarounds that work on FREE Gmail

Two exist. One is implemented; one requires a decision from you because it conflicts with
a stated constraint.

#### 8a. Implemented: put every participant on the Calendar guest list

This was a **real defect** in the previous implementation, independent of the co-host
question. `createMeetEvent` created the event with **no `attendees` at all** — the Meet
link was distributed only by email. On a meeting organized by a *personal* Google Account,
a participant who is not on the guest list must **knock**, and only the meeting
creator can admit them. The creator here is the shared backend account, which never joins
the call — **so nobody could ever be admitted.** Any student or instructor who wasn't
already signed in as the organizer risked being stuck in the lobby indefinitely.

Adding attendees is officially supported, free, requires no Workspace, and is the only
lever Google gives you here. Changes:

- [backend/src/services/google.service.ts](../backend/src/services/google.service.ts) —
  `createMeetEvent` accepts `attendeeEmails` and writes them to `event.attendees`.
  `sendUpdates: 'none'` avoids duplicating the app's own Gmail-API notification, while
  Google-account attendees still get the event on their calendar. Sets
  `guestsCanInviteOthers: false` and `guestsCanSeeOtherGuests: false` so the guest list
  cannot be widened and student rosters aren't exposed to each other.
- [backend/src/services/session.service.ts](../backend/src/services/session.service.ts) —
  passes instructor + batch student emails as the guest list, reusing the same list for
  email notifications.

**What this delivers:** requirement 1 (instructor joins before students — and before
anyone, with no lobby) and requirement 5 (screen share, which is already unrestricted
when Host Management is unavailable).

**What this deliberately does not deliver:** co-host, admit, remove, end-for-all,
recording. **Accepted trade-off:** with everyone on the guest list, there is no lobby
gatekeeping at all — anyone holding the link *and* on the list joins directly. That is
strictly better than the previous state, where nobody could be admitted, but it is not
access control. Real gatekeeping requires a host in the room, which requires 8b.

#### 8b. The only path to real host powers on free Google services: make the instructor the organizer

On a personal Google Account, **the account that creates the meeting is the host.** So
instead of trying to promote an attendee — which no API supports — create the event on the
*instructor's own* Google account:

- Each instructor completes the existing OAuth consent flow once
  (`https://www.googleapis.com/auth/calendar.events`).
- Store a refresh token per instructor.
- `createMeetEvent` uses the instructor's OAuth client instead of the shared one.

This uses **only Calendar API + OAuth**, works on **free personal Gmail**, and needs
**no Workspace**. The instructor becomes the genuine host: joins first, admits knockers,
and holds whatever host controls Google grants personal-account hosts.

**Why this is presented as a decision, not shipped:** it violates your stated constraint
that the app "MUST continue using one shared Gmail account." It keeps one Google Cloud
project and one OAuth client, but requires one stored refresh token per instructor and a
per-instructor consent step. Additional caveats you should weigh:

- **Recording still does not work** — the instructor's personal account is also free.
- Free-account host controls are narrower than Workspace's Host Management. I verified
  from Google's documentation that admit/deny on a personal-account meeting is
  creator-only (so the creator *has* it), and that Host Management — the gate on
  "remove participant" and "end meeting for all" — is documented per Workspace edition.
  **I could not confirm from documentation exactly which subset of remove / end-for-all a
  free personal-account host gets**, and I am not going to assert it. If you pursue 8b,
  verify empirically with two test accounts before promising instructors those buttons.
- With unverified OAuth consent screens, refresh tokens for external users can expire in
  7 days. Production use needs the app verified, or instructors added as test users.

**Recommendation:** if instructor host control genuinely matters, 8b is the only free path
and the shared-account constraint should be relaxed. If the constraint is firm, 8a is the
ceiling and requirements 2, 3, 4, 6 and 7 must be dropped from scope or moved to a paid
plan — and note from blocker B that even paying does not make co-host *automatic*.

### Task 9 — Anything invented?

No. Nothing in the shipped code claims, simulates, or implies co-host assignment.
Requirements that cannot be met are documented as unmet rather than faked.

---

## 3. If the constraints are ever relaxed

| Goal | Minimum requirement |
|---|---|
| Co-host set **by hand** per meeting in Calendar UI | Workspace Business Standard+ (or Workspace Individual) |
| Co-host set **programmatically** | Workspace **plus** Developer Preview Program access to Meet API v2beta `spaces.members` — cannot be requested from a `gmail.com` address |
| Meet REST API access of any kind | A Google Workspace account with Meet enabled |
| Recording (human-initiated) | Workspace Business Standard+, Workspace Individual, or Google One Premium 2 TB+ |
| Recording (automatic) | Workspace + Meet API `SpaceConfig.artifactConfig` |

**Note on Workspace Individual:** it is the one paid edition that attaches to an existing
`@gmail.com` address with no custom domain, and Google lists it as co-host-eligible and
recording-eligible. It is the cheapest way to unlock those *as manual UI actions* on the
current account. It does **not** grant Meet REST API access (that needs a real Workspace
account) and does **not** make co-host assignment scriptable.

---

## 4. References

- [Google Meet REST API overview](https://developers.google.com/workspace/meet/api/guides/overview)
- [Configure meeting spaces and members (`spaces.members`, `COHOST`, Developer Preview)](https://developers.google.com/workspace/meet/api/guides/meeting-spaces-configuration)
- [Meet REST API v2 — `spaces` resource and `SpaceConfig`](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces)
- [Meet REST API Node.js quickstart — "A Google Workspace account with Google Meet enabled"](https://developers.google.com/workspace/meet/api/guides/quickstart/nodejs)
- [Create and manage meeting spaces](https://developers.google.com/workspace/meet/api/guides/meeting-spaces)
- [Calendar API v3 — Events resource (`conferenceData`, `attendees`)](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Add co-hosts in Google Meet — eligible editions](https://support.google.com/meet/answer/10885841)
- [Manage host controls](https://support.google.com/meet/answer/16229038)
- [Add or remove people from a Google Meet meeting](https://support.google.com/meet/answer/9303164)
- [Record a video meeting](https://support.google.com/meet/answer/9308681)
- [Premium Meet features (Workspace Individual / Google One)](https://support.google.com/meet/answer/10459644)
- [Use Google Workspace premium features (Google One)](https://support.google.com/googleone/answer/12351029)
- [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview)
- [Choose your Google Workspace edition (Workspace Individual on gmail.com)](https://knowledge.workspace.google.com/admin/getting-started/editions/choose-your-google-workspace-edition)
- [Feature request: Calendar API to manage Google Meet co-hosts (issue 396661146)](https://issuetracker.google.com/issues/396661146)
