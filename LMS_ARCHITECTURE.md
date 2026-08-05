# LMS Architecture v2 — Final Design for Approval

**Project:** Student Training Portal → Internship LMS
**Version:** 2.0 — supersedes v1 entirely
**Date:** 1 August 2026
**Status:** 🟡 **DESIGN ONLY — NO IMPLEMENTATION CODE WRITTEN. Awaiting Phase 1 approval.**

**What changed from v1:** all 14 decisions approved and integrated, plus six that materially reshape the design — `LearningPath` versioning (§8 of the brief), the three-tier notification model (§6), module metadata and prerequisites (§7), server-enforced quiz timers (§13), student transfers with full history retention (§12), and expanded analytics (§9).

**Grounding:** verified against the live source. `Batch.techStackId` is required and consumed by `POST/PATCH /batches` and `BatchFormDialog.tsx` — so `LearningPath` is added *alongside* it, never in place of it. `ProgressLevel` is not referenced in application code, so a separate `ModuleDifficulty` enum introduces no coupling.

---

## 1. ARCHITECTURE DIAGRAM

### 1.1 Curriculum spine

```
TechStack ("MERN")
   │
   ├─► LearningPath ("MERN 2026", "MERN 2027")        ◄── NEW in v2: versioning
   │       │                                              Batches pin to a version.
   │       ├─► Module ("React")                           New curriculum = new row,
   │       │      │   · estimatedDurationMinutes          never a migration.
   │       │      │   · difficulty
   │       │      │   · prerequisites (metadata only)
   │       │      │
   │       │      ├─► Content ──► MediaAsset
   │       │      │      └─► ContentProgress  (views, downloads, completion)
   │       │      │
   │       │      └─► Activity ─┬─► Assignment   (1:1)
   │       │                    ├─► Quiz         (1:1) ─► QuizQuestion ─► QuizOption
   │       │                    └─► MiniProject  (1:1)
   │       │                          │
   │       │                          ├─► Submission ─┬─► SubmissionArtifact
   │       │                          │               ├─► QuizAnswer
   │       │                          │               └─► RubricScore   (empty until rubrics)
   │       │                          └─► ActivityProgress
   │       │
   │       └─► (a LearningPath is cloneable: deep-copy modules + content + activities)
   │
   └─► Batch ──┬─► learningPathId          ◄── which curriculum version this cohort runs
               ├─► StudentBatch  @@unique([studentId])   ◄── one batch per student
               ├─► InstructorBatch
               └─► Session ─► Attendance          (ALL UNCHANGED)
```

### 1.2 Cross-cutting subsystems

```
Notification  ──►  NotificationRecipient  ──►  NotificationDelivery
 (the event)        (fan-out, read state)       (per-channel outbox)
                                                 IN_APP | EMAIL → EmailService

MediaAsset    ──►  StorageService  ──►  CloudinaryProvider  (PRIMARY)
                                    └─►  SupabaseProvider    (later, no schema change)

Analytics     ──►  read-time aggregates over ContentProgress / Submission / Attendance
                    (no cron, no rollup tables — see §10)
```

### 1.3 What is deliberately absent

**No cron. No worker. No queue.** Per approved decision 3, every time-dependent behaviour resolves lazily at query time:

| Behaviour | Lazy resolution |
|---|---|
| Scheduled release | `releaseAt IS NULL OR releaseAt <= now()` in the visibility query |
| Quiz expiry | `expiresAt` stamped at attempt start; evaluated on the next request |
| Email retry | `NotificationDelivery` rows with `status = FAILED`, retried on the next notification write or an admin-triggered flush |

This guarantees Render Free compatibility: a sleeping instance can never "miss" an event, because nothing fires — state is derived when someone asks.

---

## 2. DATABASE SCHEMA

**Totals:** 21 new models · 15 new enums · 2 modified models (`TechStack`, `Batch` — additive) · 1 new constraint (`StudentBatch`) · 2 new `EnrollmentEventType` values · **0 destructive changes**.

### 2.1 The LearningPath decision

Inserting `LearningPath` between TechStack and Module is what makes *"future curriculum changes require NO migrations"* literally true. A new curriculum version is a **row**, and the modules/content beneath it are rows — never DDL.

**Where does a student's path come from?** The **batch** owns it. A batch is a cohort running one curriculum version; the student's effective path is `student → StudentBatch → Batch → LearningPath`.

I considered putting `learningPathId` directly on `User` and rejected it: it would allow a student's path to diverge from their own cohort's, which is not a state anyone wants and which every progress query would then have to reconcile.

**`Batch.techStackId` is kept.** It is required today and consumed by live endpoints and the batch form. `LearningPath` also carries `techStackId`, so the two are redundant — this is deliberate: removing the column would break working code for no benefit. The service layer enforces the invariant `batch.learningPath.techStackId === batch.techStackId`.

### 2.2 Denormalisation policy

`Content` and `Activity` carry `learningPathId` denormalised (one hop up from `Module`). This keeps the hot visibility query — run on every student page load — free of a join.

They deliberately do **not** also carry `techStackId`. Two denormalised ancestor keys is one too many; the second can drift, and tech-stack analytics can afford one join.

---

## 3. PRISMA MODELS

> Illustrative and final-intent, but **not applied**. No migration has been generated.

### 3.1 Modified existing models — additive only

```prisma
model TechStack {
  id          String  @id @default(uuid())
  name        String  @unique
  // --- NEW: all nullable/defaulted, every existing row stays valid ---
  code        String?  @unique
  description String?
  isActive    Boolean  @default(true)
  position    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  batches         Batch[]           // unchanged
  progressRecords StudentProgress[] // unchanged — instructor ratings, see §14
  users           User[]            @relation("UserTechStack")  // unchanged
  learningPaths   LearningPath[]    // NEW
}

model Batch {
  id          String @id @default(uuid())
  name        String
  techStackId String                    // KEPT — required by live endpoints
  // --- NEW ---
  learningPathId String?                // nullable only until the M1 backfill lands
  code           String?     @unique
  startDate      DateTime?
  endDate        DateTime?
  status         BatchStatus @default(ACTIVE)
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  techStack         TechStack     @relation(fields: [techStackId], references: [id])
  learningPath      LearningPath? @relation(fields: [learningPathId], references: [id], onDelete: Restrict)
  studentBatches    StudentBatch[]    // unchanged
  instructorBatches InstructorBatch[] // unchanged
  sessions          Session[]         // unchanged
  contents          Content[]         // NEW — batch-scoped overrides/additions
  activities        Activity[]        // NEW
  notifications     Notification[]    // NEW — audience = this batch

  @@index([techStackId])
  @@index([learningPathId])
  @@index([status])
}

model StudentBatch {
  studentId String
  batchId   String
  // --- NEW: records when this membership began, for transfer history ---
  assignedAt DateTime @default(now())
  student   User  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  batch     Batch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@id([studentId, batchId])
  @@unique([studentId])   // NEW — one active batch per student (approved decision 1)
  @@index([studentId])
  @@index([batchId])
}

enum BatchStatus { UPCOMING  ACTIVE  COMPLETED  ARCHIVED }

// Appended to the EXISTING enum — additive, no existing value changed.
// PostgreSQL cannot drop enum values, so additions are the only safe edit.
enum EnrollmentEventType {
  // ... all existing values unchanged ...
  BATCH_ASSIGNED      // NEW
  BATCH_TRANSFERRED   // NEW
}
```

`User`, `Session`, `Attendance`, `StudentProgress`, `InstructorBatch`, `EnrollmentEvent` — **no column changes**, only Prisma back-relations, which emit no SQL.

### 3.2 Curriculum

```prisma
enum LearningPathStatus { DRAFT  PUBLISHED  ARCHIVED }
enum ModuleDifficulty   { BEGINNER  INTERMEDIATE  ADVANCED }

/// A versioned curriculum for a tech stack. "MERN 2026", "React 20".
/// Cloning one deep-copies its modules, content and activities — an application
/// operation, never a migration. This is what keeps curriculum evolution
/// schema-free.
model LearningPath {
  id          String @id @default(uuid())
  techStackId String
  name        String                      // "MERN 2026"
  version     String                      // "2026.1"
  description String?
  status      LearningPathStatus @default(DRAFT)
  /// The path new batches receive unless an admin picks another.
  isDefault   Boolean  @default(false)
  effectiveFrom DateTime?
  /// Provenance when this path was cloned from another.
  clonedFromId String?
  createdById  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  techStack  TechStack     @relation(fields: [techStackId], references: [id], onDelete: Cascade)
  clonedFrom LearningPath? @relation("PathLineage", fields: [clonedFromId], references: [id], onDelete: SetNull)
  clones     LearningPath[] @relation("PathLineage")
  createdBy  User?         @relation("PathAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  modules    Module[]
  contents   Content[]
  activities Activity[]
  batches    Batch[]

  @@unique([techStackId, version])
  @@index([techStackId, status])
}

model Module {
  id             String @id @default(uuid())
  learningPathId String
  name           String
  description    String?
  position       Int     @default(0)
  isVisible      Boolean @default(true)

  // --- Metadata (approved decision 7). Descriptive only — NOT enforced. ---
  estimatedDurationMinutes Int?
  difficulty               ModuleDifficulty?

  /// Reserved for AI Tutor / AI quiz generation. Unstructured so AI metadata
  /// never requires a migration.
  aiMetadata  Json?
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  learningPath  LearningPath @relation(fields: [learningPathId], references: [id], onDelete: Cascade)
  createdBy     User?        @relation("ModuleAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  contents      Content[]
  activities    Activity[]
  prerequisites ModulePrerequisite[] @relation("ModuleRequires")
  requiredBy    ModulePrerequisite[] @relation("ModuleRequiredBy")

  @@index([learningPathId, position])
  @@index([learningPathId, isVisible])
}

/// Prerequisite graph. Stored as a relation rather than a text field so it can
/// be *enforced* later by adding a check to the visibility resolver — with no
/// schema change. Today it is displayed and nothing more.
model ModulePrerequisite {
  moduleId       String
  prerequisiteId String
  module       Module @relation("ModuleRequires",   fields: [moduleId],       references: [id], onDelete: Cascade)
  prerequisite Module @relation("ModuleRequiredBy", fields: [prerequisiteId], references: [id], onDelete: Cascade)
  @@id([moduleId, prerequisiteId])
  @@index([prerequisiteId])
}
```

### 3.3 Content

```prisma
enum ContentType     { PDF  PPT  DOCX  GITHUB_REPO  RECORDING  LINK  VIDEO }
enum ContentStatus   { DRAFT  PUBLISHED  ARCHIVED }
enum VisibilityScope { LEARNING_PATH  BATCH }

model Content {
  id             String @id @default(uuid())
  moduleId       String
  learningPathId String              // denormalised one hop — keeps the hot query join-free
  title          String
  description    String?
  type           ContentType
  status         ContentStatus @default(DRAFT)
  position       Int           @default(0)

  // --- Visibility (§6.3) ---
  scope       VisibilityScope @default(LEARNING_PATH)
  batchId     String?
  overridesId String?         @unique

  releaseAt DateTime?          // NULL = immediate; evaluated lazily at read time

  // --- Payload: exactly one populated, per `type` ---
  assetId     String?          // PDF / PPT / DOCX / VIDEO
  externalUrl String?          // GITHUB_REPO / RECORDING / LINK

  version     Int      @default(1)
  createdById String?
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  module       Module       @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  learningPath LearningPath @relation(fields: [learningPathId], references: [id], onDelete: Cascade)
  batch        Batch?       @relation(fields: [batchId], references: [id], onDelete: Cascade)
  asset        MediaAsset?  @relation(fields: [assetId], references: [id], onDelete: SetNull)
  overrides    Content?     @relation("ContentOverride", fields: [overridesId], references: [id], onDelete: SetNull)
  overriddenBy Content?     @relation("ContentOverride")
  createdBy    User?        @relation("ContentAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  updatedBy    User?        @relation("ContentEditor", fields: [updatedById], references: [id], onDelete: SetNull)
  progress     ContentProgress[]

  @@index([moduleId, status, position])
  @@index([learningPathId, status])
  @@index([batchId])
  @@index([releaseAt])
}
```

### 3.4 Activity supertype

```prisma
enum ActivityType   { ASSIGNMENT  QUIZ  MINI_PROJECT }
enum ActivityStatus { DRAFT  PUBLISHED  ARCHIVED }
enum SubmissionMode { GITHUB_URL  FILE_UPLOAD  ZIP  LIVE_URL  DOCUMENTATION }

/// Everything shared by assignments, quizzes and mini-projects lives here —
/// so rubrics, multiple attempts, certificates, AI evaluation, notifications
/// and analytics attach ONCE (approved decision 4).
model Activity {
  id             String @id @default(uuid())
  learningPathId String
  moduleId       String?            // nullable: a capstone may span modules
  type           ActivityType
  title          String
  description    String?
  instructions   String?
  maxMarks       Int            @default(100)
  passMarks      Int?
  dueAt          DateTime?
  releaseAt      DateTime?
  status         ActivityStatus @default(DRAFT)
  position       Int            @default(0)

  scope       VisibilityScope @default(LEARNING_PATH)
  batchId     String?
  overridesId String?         @unique

  /// >1 enables multiple attempts with no schema change.
  maxAttempts  Int   @default(1)
  /// Reserved: AI evaluation config, generated-content provenance.
  aiMetadata   Json?

  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  learningPath LearningPath @relation(fields: [learningPathId], references: [id], onDelete: Cascade)
  module       Module?      @relation(fields: [moduleId], references: [id], onDelete: SetNull)
  batch        Batch?       @relation(fields: [batchId], references: [id], onDelete: Cascade)
  overrides    Activity?    @relation("ActivityOverride", fields: [overridesId], references: [id], onDelete: SetNull)
  overriddenBy Activity?    @relation("ActivityOverride")
  createdBy    User?        @relation("ActivityAuthor", fields: [createdById], references: [id], onDelete: SetNull)

  assignment  Assignment?
  quiz        Quiz?
  miniProject MiniProject?
  submissions Submission[]
  progress    ActivityProgress[]
  criteria    RubricCriterion[]

  @@index([learningPathId, type, status])
  @@index([moduleId, position])
  @@index([batchId])
  @@index([dueAt])
}

model Assignment {
  activityId        String @id
  acceptedModes     SubmissionMode[]     // GITHUB_URL and/or FILE_UPLOAD
  starterRepoUrl    String?
  starterAssetId    String?
  attachmentAssetId String?
  activity        Activity    @relation(fields: [activityId], references: [id], onDelete: Cascade)
  starterAsset    MediaAsset? @relation("AssignmentStarter",    fields: [starterAssetId],    references: [id], onDelete: SetNull)
  attachmentAsset MediaAsset? @relation("AssignmentAttachment", fields: [attachmentAssetId], references: [id], onDelete: SetNull)
}

model Quiz {
  activityId             String  @id
  /// NULL = untimed. When set, the server stamps Submission.expiresAt at
  /// attempt start and is the sole authority on expiry (decision 13).
  timeLimitMins          Int?
  /// Grace for clock skew and in-flight requests. Never shown to the student.
  graceSeconds           Int     @default(30)
  shuffleQuestions       Boolean @default(false)
  shuffleOptions         Boolean @default(false)
  showResultsImmediately Boolean @default(true)
  activity  Activity       @relation(fields: [activityId], references: [id], onDelete: Cascade)
  questions QuizQuestion[]
}

model QuizQuestion {
  id          String @id @default(uuid())
  quizId      String
  text        String
  marks       Int    @default(1)
  position    Int    @default(0)
  explanation String?
  quiz    Quiz         @relation(fields: [quizId], references: [id], onDelete: Cascade)
  options QuizOption[]
  answers QuizAnswer[]
  @@index([quizId, position])
}

model QuizOption {
  id         String  @id @default(uuid())
  questionId String
  text       String
  isCorrect  Boolean @default(false)   // NEVER serialised to a student — §7.4
  position   Int     @default(0)
  question QuizQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  chosenBy QuizAnswer[]
  @@index([questionId, position])
}

model MiniProject {
  activityId          String @id
  requirementsAssetId String?
  /// Multi-select: an admin may demand GitHub AND a live URL AND docs.
  acceptedModes       SubmissionMode[]
  activity          Activity    @relation(fields: [activityId], references: [id], onDelete: Cascade)
  requirementsAsset MediaAsset? @relation("ProjectRequirements", fields: [requirementsAssetId], references: [id], onDelete: SetNull)
}
```

### 3.5 Submissions, evaluation, server-enforced timer

```prisma
enum SubmissionStatus {
  IN_PROGRESS         // quiz attempt started, timer running
  SUBMITTED
  LATE                // after dueAt
  AUTO_SUBMITTED      // timer expired; server finalised whatever was answered
  EVALUATED
  RESUBMIT_REQUESTED
}

model Submission {
  id            String @id @default(uuid())
  activityId    String
  studentId     String
  attemptNumber Int              @default(1)
  status        SubmissionStatus @default(SUBMITTED)

  // --- Server-enforced timing (decision 13) ---
  /// Stamped server-side when the attempt is opened.
  startedAt   DateTime?
  /// startedAt + Quiz.timeLimitMins, computed server-side. The browser is
  /// never trusted; a late POST is rejected or auto-finalised against THIS.
  expiresAt   DateTime?
  submittedAt DateTime?

  githubUrl String?
  liveUrl   String?
  notes     String?

  // --- Evaluation: marks + remarks only, per brief ---
  marks         Int?
  remarks       String?
  evaluatedById String?
  evaluatedAt   DateTime?
  /// AI suggestion, kept structurally separate from the human verdict so it can
  /// never be mistaken for an instructor's decision.
  aiEvaluation  Json?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  activity    Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  student     User     @relation("StudentSubmissions", fields: [studentId], references: [id], onDelete: Cascade)
  evaluatedBy User?    @relation("SubmissionEvaluator", fields: [evaluatedById], references: [id], onDelete: SetNull)
  artifacts   SubmissionArtifact[]
  quizAnswers QuizAnswer[]
  scores      RubricScore[]

  @@unique([activityId, studentId, attemptNumber])
  @@index([activityId, status])
  @@index([studentId])
  @@index([evaluatedById])
  @@index([status, expiresAt])   // finds expired in-progress attempts lazily
}

model SubmissionArtifact {
  id           String @id @default(uuid())
  submissionId String
  assetId      String
  label        String?
  submission Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  asset      MediaAsset @relation(fields: [assetId], references: [id], onDelete: Restrict)
  @@index([submissionId])
}

/// Written incrementally as the student answers, so an expired attempt still
/// has everything answered up to the cut-off.
model QuizAnswer {
  id           String  @id @default(uuid())
  submissionId String
  questionId   String
  optionId     String?          // NULL = unanswered
  isCorrect    Boolean @default(false)
  marksAwarded Int     @default(0)
  answeredAt   DateTime @default(now())
  submission Submission   @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  question   QuizQuestion @relation(fields: [questionId],   references: [id], onDelete: Cascade)
  option     QuizOption?  @relation(fields: [optionId],     references: [id], onDelete: SetNull)
  @@unique([submissionId, questionId])
}

/// Ships EMPTY in Phase 2. Present so rubrics need no redesign.
model RubricCriterion {
  id         String @id @default(uuid())
  activityId String
  label      String
  maxMarks   Int
  position   Int    @default(0)
  activity Activity      @relation(fields: [activityId], references: [id], onDelete: Cascade)
  scores   RubricScore[]
  @@index([activityId, position])
}

model RubricScore {
  id           String @id @default(uuid())
  submissionId String
  criterionId  String
  marks        Int
  remarks      String?
  submission Submission      @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  criterion  RubricCriterion @relation(fields: [criterionId],  references: [id], onDelete: Cascade)
  @@unique([submissionId, criterionId])
}
```

### 3.6 Progress

```prisma
/// Objective consumption. Distinct from StudentProgress (instructor's manual
/// rating), which is untouched — approved decision 2.
model ContentProgress {
  id        String @id @default(uuid())
  studentId String
  contentId String

  // Split counters power the §10 analytics without an event-log table.
  viewCount    Int @default(0)
  downloadCount Int @default(0)
  openCount    Int @default(0)   // external links / recordings

  firstViewedAt DateTime  @default(now())
  /// Drives the "Continue Learning" widget (§11).
  lastViewedAt  DateTime  @default(now())
  completedAt   DateTime?
  secondsSpent  Int       @default(0)

  student User    @relation("StudentContentProgress", fields: [studentId], references: [id], onDelete: Cascade)
  content Content @relation(fields: [contentId], references: [id], onDelete: Cascade)

  @@unique([studentId, contentId])
  @@index([studentId, lastViewedAt])   // "resume where you left off"
  @@index([contentId])
}

model ActivityProgress {
  id          String @id @default(uuid())
  studentId   String
  activityId  String
  startedAt   DateTime?
  submittedAt DateTime?
  passedAt    DateTime?
  bestMarks   Int?
  attemptCount Int      @default(0)
  student  User     @relation("StudentActivityProgress", fields: [studentId], references: [id], onDelete: Cascade)
  activity Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  @@unique([studentId, activityId])
  @@index([studentId])
  @@index([activityId])
}
```

### 3.7 Storage

```prisma
enum StorageProvider { CLOUDINARY  SUPABASE }

model MediaAsset {
  id               String @id @default(uuid())
  provider         StorageProvider @default(CLOUDINARY)   // Cloudinary is primary
  providerKey      String                                  // public_id / path — what we delete by
  url              String
  originalFilename String
  mimeType         String
  sizeBytes        Int
  checksum         String?
  uploadedById     String?
  createdAt        DateTime @default(now())

  uploadedBy User? @relation("AssetUploader", fields: [uploadedById], references: [id], onDelete: SetNull)
  contents              Content[]
  submissionArtifacts   SubmissionArtifact[]
  assignmentStarters    Assignment[]  @relation("AssignmentStarter")
  assignmentAttachments Assignment[]  @relation("AssignmentAttachment")
  projectRequirements   MiniProject[] @relation("ProjectRequirements")

  @@unique([provider, providerKey])
  @@index([uploadedById])
}
```

### 3.8 Notifications — three tiers

```prisma
enum NotificationType {
  NOTES_UPLOADED  VIDEO_UPLOADED  RECORDING_UPLOADED
  ASSIGNMENT_PUBLISHED  QUIZ_PUBLISHED  PROJECT_PUBLISHED
  ASSIGNMENT_EVALUATED  PROJECT_EVALUATED  QUIZ_EVALUATED
  DUE_DATE_REMINDER  UPCOMING_SESSION  ANNOUNCEMENT
  BATCH_TRANSFERRED
}
enum NotificationAudience { INDIVIDUAL  BATCH  LEARNING_PATH  TECH_STACK  ROLE  BROADCAST }
enum NotificationChannel  { IN_APP  EMAIL }
enum DeliveryStatus       { PENDING  SENT  FAILED  SKIPPED }

/// TIER 1 — the event. Written ONCE regardless of audience size.
/// Body and link are authored here, not duplicated per person.
model Notification {
  id       String               @id @default(uuid())
  type     NotificationType
  audience NotificationAudience
  title    String
  body     String?
  linkUrl  String?

  /// Soft reference to the subject (content, activity, session…). Generic by
  /// design: a new notifiable thing needs an enum value and nothing else.
  entityType String?
  entityId   String?

  /// Audience targets. Exactly one is set, matching `audience`.
  batchId        String?
  learningPathId String?
  techStackId    String?
  targetRole     Role?

  createdById String?
  createdAt   DateTime @default(now())

  batch      Batch? @relation(fields: [batchId], references: [id], onDelete: Cascade)
  createdBy  User?  @relation("NotificationAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  recipients NotificationRecipient[]

  @@index([type, createdAt])
  @@index([batchId])
}

/// TIER 2 — fan-out and per-person read state.
/// A 30-student batch announcement = 1 Notification + 30 of these.
model NotificationRecipient {
  id             String @id @default(uuid())
  notificationId String
  userId         String
  readAt         DateTime?
  createdAt      DateTime  @default(now())

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  user         User         @relation("NotificationRecipient", fields: [userId], references: [id], onDelete: Cascade)
  deliveries   NotificationDelivery[]

  @@unique([notificationId, userId])
  /// Powers the unread badge — the single most frequent notification query.
  @@index([userId, readAt, createdAt])
}

/// TIER 3 — per-channel outcome. This IS the email outbox the project has
/// never had: a FAILED row is a retryable record, not a lost log line.
///
/// `provider` is free text rather than an enum so swapping Gmail for a
/// transactional provider (SendGrid, Postmark, SES) requires no migration —
/// approved decision 14.
model NotificationDelivery {
  id          String @id @default(uuid())
  recipientId String
  channel     NotificationChannel
  status      DeliveryStatus @default(PENDING)
  attempts    Int       @default(0)
  lastAttemptAt DateTime?
  failureReason String?
  provider      String?     // "gmail-api" | "smtp" | "sendgrid" | …
  providerMessageId String?
  sentAt        DateTime?

  recipient NotificationRecipient @relation(fields: [recipientId], references: [id], onDelete: Cascade)

  @@unique([recipientId, channel])
  @@index([status, channel])   // the retry sweep query
}
```

**Why the middle tier matters.** Under v1's two-tier model, a batch announcement wrote 30 `Notification` rows — the same title and body duplicated 30 times, with no way to ask "what was announced?" independently of "who saw it". Three tiers separate **what happened** (1 row), **who it reached and who read it** (N rows), and **how it was delivered** (N × channels). Editing an announcement now touches one row.

---

## 4. ENTITY RELATIONSHIPS

| From | To | Card. | On delete | Rationale |
|---|---|---|---|---|
| TechStack → LearningPath | 1:N | Cascade | Paths are meaningless without their stack |
| LearningPath → Module | 1:N | Cascade | |
| LearningPath → Batch | 1:N | **Restrict** | **Refuse to delete a path a cohort is running** |
| LearningPath → LearningPath (lineage) | 1:N | SetNull | Deleting an old path must not orphan its clone |
| Module → Content | 1:N | Cascade | |
| Module → Activity | 1:N | **SetNull** | A capstone survives a module restructure |
| Module ↔ Module (prerequisite) | M:N | Cascade | |
| Content → Content (override) | 1:1 | SetNull | Deleting a global item must not delete the batch override |
| Batch → Content / Activity | 1:N | Cascade | Batch-scoped items die with the batch |
| Activity → Assignment/Quiz/MiniProject | 1:1 | Cascade | Detail cannot outlive its supertype |
| Activity → Submission | 1:N | Cascade | |
| Activity → RubricCriterion | 1:N | Cascade | |
| User → Submission | 1:N | Cascade | Matches existing `Attendance` precedent |
| Submission → evaluator (User) | N:1 | **SetNull** | Removing an instructor never erases a grade |
| MediaAsset → SubmissionArtifact | 1:N | **Restrict** | Refuse to delete a file a submission depends on |
| Content → MediaAsset | N:1 | SetNull | Content survives; UI shows "file unavailable" |
| Notification → NotificationRecipient | 1:N | Cascade | |
| NotificationRecipient → NotificationDelivery | 1:N | Cascade | |
| User → NotificationRecipient | 1:N | Cascade | |

**Two protective `Restrict`s** are the only places the database will refuse a delete: a `LearningPath` in use by a batch, and a `MediaAsset` referenced by a submission. Both protect student work.

**Every `createdBy` / `updatedBy` / `evaluatedBy` is `SetNull`**, matching the precedent already set by `EnrollmentEvent.actorId`: removing a staff member never erases the record of what they did.

---

## 5. MIGRATION PLAN

| # | Name | Contents | Risk |
|---|---|---|---|
| **M1** | `lms_foundation` | TechStack/Batch additive columns · `LearningPath`, `Module`, `ModulePrerequisite`, `Content`, `MediaAsset`, `ContentProgress` · 7 enums · **legacy-path backfill** | 🟡 Contains the only data write |
| **M2** | `lms_single_batch` | `@@unique([studentId])` + `StudentBatch.assignedAt` · `BATCH_ASSIGNED`/`BATCH_TRANSFERRED` enum values | 🔴 **Fails if any student is in 2+ batches** |
| **M3** | `lms_activities` | `Activity` + 3 details · quiz tables · `Submission`, artifacts, `QuizAnswer` · rubric tables · `ActivityProgress` | 🟢 Additive |
| **M4** | `lms_engagement` | `Notification`, `NotificationRecipient`, `NotificationDelivery` · 4 enums | 🟢 Additive |

### 5.1 M1's backfill — the one data write

`Batch.learningPathId` cannot be `NOT NULL` on day one because existing batches have no path. M1 therefore:

1. Creates the `LearningPath` table.
2. Inserts one path per existing tech stack: `name = '<TechStack> (Legacy)'`, `version = 'v1'`, `status = PUBLISHED`, `isDefault = true`.
3. Sets every existing `Batch.learningPathId` to its stack's legacy path.

The column stays **nullable** in M1. Promoting it to `NOT NULL` is deferred to a later migration once every write path guarantees it — a nullable FK that is always populated is safer than a `NOT NULL` that can fail a deploy.

Rollback is still total: dropping the column and table discards the backfill, and no pre-existing column is modified.

### 5.2 M2's pre-flight gate (approved decision 1)

M2 must **not** be attempted blind. A dedicated command runs first:

```
npm run lms:preflight
```

It executes:

```sql
SELECT sb."studentId", u.name, u.email, COUNT(*) AS batch_count,
       string_agg(b.name, ', ' ORDER BY b.name) AS batches
FROM "StudentBatch" sb
JOIN "User"  u ON u.id = sb."studentId"
JOIN "Batch" b ON b.id = sb."batchId"
GROUP BY sb."studentId", u.name, u.email
HAVING COUNT(*) > 1
ORDER BY batch_count DESC;
```

**Contract:**

| Outcome | Exit code | Behaviour |
|---|---|---|
| No rows | `0` | ✅ Safe. M2 may proceed. |
| Rows found | `1` | ❌ **Abort.** Prints a cleanup report and writes `multi-batch-students.csv` (student, email, batch count, batch names, most recent assignment) |

The report **does not auto-resolve anything.** Choosing which batch a student belongs to is an academic decision, not one a migration should make silently. The admin resolves each case in the UI, re-runs the pre-flight, and only then is M2 applied.

The deploy pipeline gains one line before `migrate deploy`:
```
npm run lms:preflight && npx prisma migrate deploy
```

### 5.3 Ordering rule

M1 → *(pre-flight gate)* → M2 → M3 → M4. M1 may ship independently of M2; **M3 and M4 must not ship before M2**, because submission and notification code assumes a single resolvable batch per student.

---

## 6. API DESIGN

All additive, all under `/api`. **No existing endpoint changes response shape.** The one behaviour change is `POST /batches/:id/students` becoming a move (§14).

### 6.1 Curriculum — Phase 1

| Method | Route | Role | Notes |
|---|---|---|---|
| GET/POST | `/techstacks/:id/learning-paths` | All / ADMIN | |
| PATCH/DELETE | `/learning-paths/:id` | ADMIN | DELETE blocked if a batch uses it (`Restrict`) |
| POST | `/learning-paths/:id/clone` | ADMIN | **Deep-copies modules, content, activities.** How curriculum versioning happens without migrations |
| POST | `/learning-paths/:id/publish` · `/archive` | ADMIN | |
| GET/POST | `/learning-paths/:id/modules` | All / ADMIN | |
| PATCH/DELETE | `/modules/:id` | ADMIN | Metadata: duration, difficulty, prerequisites |
| PATCH | `/learning-paths/:id/modules/reorder` | ADMIN | `{ orderedIds: [] }`, one transaction |
| PUT | `/modules/:id/prerequisites` | ADMIN | `{ moduleIds: [] }` — replaces the set |
| GET/POST | `/modules/:id/contents` | All / ADMIN | GET is visibility-filtered |
| PATCH/DELETE | `/contents/:id` | ADMIN | |
| PATCH | `/modules/:id/contents/reorder` | ADMIN | |
| POST | `/contents/:id/publish` · `/archive` | ADMIN | |
| POST | `/contents/:id/override` | ADMIN | `{ batchId }` — creates the batch override |
| POST | `/contents/:id/view` · `/download` · `/open` | STUDENT | Increments the matching counter |
| POST | `/uploads/sign` | ADMIN | Signed Cloudinary params; enforces size/MIME caps |
| POST | `/uploads/confirm` | ADMIN | Creates the `MediaAsset` after client-side upload |

### 6.2 Activities & submissions — Phase 2

| Method | Route | Role | Notes |
|---|---|---|---|
| GET/POST | `/learning-paths/:id/activities?type=` | All / ADMIN | |
| PATCH/DELETE | `/activities/:id` | ADMIN | |
| POST | `/activities/:id/publish` · `/archive` | ADMIN | Publishing fans out a notification |
| CRUD | `/quizzes/:id/questions[/:qid]` | ADMIN | |
| **POST** | **`/activities/:id/attempts`** | STUDENT | **Opens an attempt. Server stamps `startedAt` + `expiresAt`.** Returns questions *without* `isCorrect` |
| PATCH | `/submissions/:id/answers` | STUDENT | Incremental autosave; rejected once expired |
| POST | `/submissions/:id/submit` | STUDENT | Server re-checks `expiresAt`; late → `AUTO_SUBMITTED` |
| POST | `/activities/:id/submissions` | STUDENT | Non-quiz submit (assignment / project) |
| GET | `/activities/:id/submissions` | ADMIN, INSTRUCTOR | Instructor scoped to assigned batches |
| GET | `/submissions/mine` | STUDENT | |
| PATCH | `/submissions/:id/evaluate` | ADMIN, INSTRUCTOR | `{ marks, remarks }` |

### 6.3 Visibility resolver — one implementation, used everywhere

```
visible(module M, batch B, now T) =
      { items in M where scope = LEARNING_PATH
          AND NOT EXISTS (override for B) }
    ∪ { items in M where scope = BATCH AND batchId = B }
  filtered by status = PUBLISHED
          AND (releaseAt IS NULL OR releaseAt <= T)
```

| Admin intent | `scope` | `batchId` | `overridesId` |
|---|---|---|---|
| Global resource | `LEARNING_PATH` | null | null |
| **Inherit + Add** | `BATCH` | B | **null** |
| **Override** | `BATCH` | B | G |

An override is reversible by deleting one row; the global item is never mutated.

### 6.4 Quiz timer — the server is the only clock

```
POST /activities/:id/attempts
   └─ server: startedAt = now(); expiresAt = now() + timeLimitMins
      returns { submissionId, expiresAt, questions[] }   ← no isCorrect, no explanation

PATCH /submissions/:id/answers      (autosave, repeatable)
   └─ if now() > expiresAt + graceSeconds → 409, attempt is closed

POST /submissions/:id/submit
   ├─ now() <= expiresAt + grace  → SUBMITTED,      auto-graded
   └─ now() >  expiresAt + grace  → AUTO_SUBMITTED, graded on answers saved before the cut-off

GET  /submissions/:id   (or any read touching an IN_PROGRESS attempt)
   └─ if now() > expiresAt + grace → lazily finalise to AUTO_SUBMITTED
```

The browser countdown is **cosmetic**. A tampered clock, a closed tab, or a lost connection all resolve to the same server-side outcome, and no cron is needed — expiry is settled the next time anyone looks (approved decisions 3 + 13 together).

### 6.5 Phase 3

`GET /me/dashboard` · `GET /me/progress` · `GET /me/continue-learning` · `GET /students/:id/progress` · `GET /notifications` · `PATCH /notifications/:id/read` · `POST /notifications/read-all` · `POST /announcements` · analytics routes in §10.

### 6.6 Two invariants enforced in the service layer

1. **Answer keys never leave the server for a student.** `isCorrect` and `explanation` are stripped in `quiz.service.ts`, not in a controller — so no future endpoint can leak them by forgetting.
2. **Visibility is always resolved server-side.** No query parameter can cause unpublished, unreleased, or other-batch content to be returned. The client never filters for correctness.

---

## 7. PERMISSION MATRIX

Enforced by a policy layer (`policies/lms.policy.ts`) rather than role checks alone, because the instructor rules are **relational** — "batches I am assigned to" — which `restrictTo()` cannot express.

| Capability | Admin | Instructor | Student |
|---|---|---|---|
| Learning paths — create / edit / clone / publish | ✅ | ❌ | ❌ |
| Modules — create / edit / reorder / metadata | ✅ | ❌ | ❌ |
| Content — create / edit / reorder / publish / override | ✅ | ❌ | ❌ |
| Activities — create / edit / publish | ✅ | ❌ | ❌ |
| Upload files | ✅ | ❌ | ✅ own submissions only |
| View curriculum | ✅ all | ✅ **assigned batches only** | ✅ own batch, published + released |
| View submissions | ✅ all | ✅ **assigned batches only** | ✅ own only |
| Evaluate submissions | ✅ | ✅ **assigned batches only** | ❌ |
| Analytics | ✅ all | ✅ **assigned batches only** | ❌ |
| Own progress | ✅ any | ✅ assigned batches | ✅ own only |
| Send announcements | ✅ any audience | ✅ assigned batches | ❌ |
| Move student between batches | ✅ | ❌ | ❌ |

**Instructor scoping (approved decision 11) is a single reusable predicate:**

```
instructorBatchIds(user) = InstructorBatch.batchId where instructorId = user.id
```

Every instructor-facing query filters through it. An instructor never sees a batch they are not assigned to, even by guessing an id — this is a 403, not an empty list, so the boundary is unambiguous.

**This also closes a pre-existing hole.** The original audit found instructors could mutate *any* session because only roles were checked. The policy layer lands in Phase 1, before any content exists to leak.

---

## 8. NOTIFICATION ARCHITECTURE

### 8.1 Flow

```
Trigger (content published, assignment graded, session upcoming…)
   │
   ▼
NotificationService.notify({ type, audience, targets, entity, title, body })
   │
   ├─ 1. INSERT Notification                        ← ONE row, whatever the audience
   │
   ├─ 2. Resolve audience → user ids
   │        INDIVIDUAL    → [userId]
   │        BATCH         → students of that batch (+ its instructors)
   │        LEARNING_PATH → students of every batch on that path
   │        TECH_STACK    → students of every batch under that stack
   │        ROLE          → all active users with that role
   │        BROADCAST     → all active users
   │
   ├─ 3. createMany NotificationRecipient           ← N rows, read state per person
   │
   └─ 4. For each recipient × enabled channel → NotificationDelivery (PENDING)
            IN_APP → marked SENT immediately (the row IS the delivery)
            EMAIL  → handed to the existing EmailService; result recorded
```

### 8.2 Email is unchanged, only wrapped

`NotificationService` calls the **existing** `EmailService.send()`. The SMTP → Gmail API fallback, circuit breaker, per-recipient isolation and startup diagnostics are not modified in any way. The delivery row records the outcome the email layer already returns (`delivered`, `reason`).

Gmail's ~500 recipients/day is accepted for current scale (approved decision 14). The design stays honest about the ceiling:

- `NotificationDelivery.provider` is **free text, not an enum** — swapping to SendGrid/Postmark/SES requires no migration.
- Per-type email opt-out means only high-value events (`ASSIGNMENT_PUBLISHED`, `*_EVALUATED`, `DUE_DATE_REMINDER`) email by default; routine uploads are in-app only.
- A `FAILED` row is a durable, retryable record — the first time this project has had an email outbox at all.

### 8.3 Retry without a worker

Consistent with decision 3, retry is **opportunistic**:
1. Every `notify()` call first flushes up to N `FAILED` deliveries older than a backoff window.
2. An admin can trigger `POST /notifications/flush` manually.
3. The Notifications admin screen surfaces the failed count so it is visible, not silent.

**Honest limitation:** on a completely idle system nothing retries. That is the accepted trade for zero infrastructure. Adding a scheduler later changes one call site and no schema.

---

## 9. STORAGE ARCHITECTURE

**Cloudinary is primary** (approved decision 5). Supabase remains implementable behind the same interface with no schema change — `MediaAsset.provider` already distinguishes them and `@@unique([provider, providerKey])` keeps keys from colliding across providers.

```ts
interface StorageProvider {
  readonly name: 'CLOUDINARY' | 'SUPABASE';
  createSignedUpload(input: SignedUploadRequest): Promise<SignedUploadTicket>;
  getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
```

`StorageService` is the **only** module that imports a provider SDK. Controllers, services and the entire frontend deal in `MediaAsset` ids — never a provider URL.

### 9.1 Upload flow — files never touch Node

```
1. Client → POST /uploads/sign { filename, mimeType, sizeBytes, purpose }
              server validates MIME allow-list + size cap, returns a
              short-lived signature scoped to one folder
2. Client → POST direct to Cloudinary            ← the file never reaches our server
3. Client → POST /uploads/confirm { providerKey, url, … }
              server creates the MediaAsset row
```

| | Via Node (multer) | **Signed direct (chosen)** |
|---|---|---|
| Render memory | Whole file buffered | Nothing |
| `express.json({limit:'10kb'})` | Must be raised | **Untouched** |
| Bandwidth cost | Doubled | Zero |
| Upload latency | Two hops | One |

Enforcing caps **at signing time** means an oversized file is rejected before a single byte is uploaded.

### 9.2 Orphan and integrity policy

- `SubmissionArtifact → MediaAsset` is `Restrict`: the database refuses to delete a file a student's submission depends on.
- `Content → MediaAsset` is `SetNull`: content survives a missing file and renders "file unavailable".
- Assets with zero references are collected by an admin-triggered sweep (no cron), surfaced with a storage-usage figure.

---

## 10. ANALYTICS ARCHITECTURE

### 10.1 Design stance: computed, not materialised

Decision 3 forbids cron, so there is no nightly rollup — and at this scale none is needed. Every metric below is an **indexed aggregate over existing tables**, computed on read.

I deliberately rejected an append-only `ContentEvent` log. Split counters on `ContentProgress` (`viewCount`, `downloadCount`, `openCount`) answer every requested metric without an unbounded table. `ContentEvent` can be added later, purely additively, if time-series ("views last 7 days") is ever wanted — that requirement does not exist today.

### 10.2 Metric → source map

| Metric | Computed from |
|---|---|
| Most / Least Viewed Notes | `ContentProgress.viewCount` grouped by content (LEFT JOIN for zero-view items) |
| Most Downloaded PDFs | `ContentProgress.downloadCount`, filtered `type = PDF` |
| Most Opened Recordings | `ContentProgress.openCount`, filtered `type = RECORDING` |
| Assignment Completion % | `Submission` count ÷ eligible students, per activity |
| Quiz Pass Rate | `Submission.marks >= Activity.passMarks` ÷ attempts |
| Average Marks | `avg(Submission.marks)` per activity / module / batch |
| Most Failed Quiz | Lowest pass rate, `type = QUIZ`, ordered ascending |
| Average Module Completion | `ContentProgress.completedAt` + `ActivityProgress.passedAt` ÷ visible items |
| Batch Performance | Marks + completion + attendance, grouped by batch |
| Tech Stack Performance | Same, rolled up through LearningPath → TechStack |
| Instructor Performance | Sessions held, attendance rate, evaluation turnaround (`evaluatedAt − submittedAt`), average marks awarded |
| Student Rankings | Composite of completion %, average marks, attendance |

### 10.3 Endpoints

`GET /analytics/overview` · `/analytics/batch/:id` · `/analytics/learning-path/:id` · `/analytics/tech-stack/:id` · `/analytics/content` (most/least viewed, downloads) · `/analytics/activities` (completion, pass rates, most-failed) · `/analytics/instructors` · `/analytics/rankings?batchId=`

All accept `?from=&to=` and are **paginated from day one** — a deliberate contrast with the existing `/progress/overview`, which fetches every row globally and is a known scaling wall.

### 10.4 Instructor scoping

Every analytics endpoint applies §7's `instructorBatchIds` predicate. An instructor's "batch performance" covers only their batches; only an admin sees cross-batch or tech-stack-wide figures.

---

## 11. STUDENT DASHBOARD DESIGN

Served by a single `GET /me/dashboard` — one round trip, one visibility resolution, no client-side assembly.

```
┌──────────────────────────────────────────────────────────────────┐
│  Welcome back, John                          MERN · Batch 2026-A │
├──────────────────────────────────────────────────────────────────┤
│  ▶ CONTINUE LEARNING                                    ← NEW    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  React · Module 4                                          │  │
│  │  "useEffect and the dependency array"          ▓▓▓▓▓▓░░ 60%│  │
│  │                                          [ Resume Module → ]│  │
│  └────────────────────────────────────────────────────────────┘  │
├───────────────────────────────┬──────────────────────────────────┤
│  TODAY'S CLASS                │  MY PROGRESS                     │
│  React Hooks Deep Dive        │  HTML       ██████████ 100%      │
│  10:00 · Asha Rao             │  CSS        ██████████ 100%      │
│  [ Join Meet → ]              │  JavaScript ████████░░  80%      │
│                               │  React      ██████░░░░  60%      │
│  PENDING ASSIGNMENTS  (2)     │  Node       ░░░░░░░░░░   0%      │
│  · Todo App      due in 2d ⚠  │  ────────────────────────────    │
│  · Hooks Lab     due in 5d    │  Overall              68%        │
│                               │  Instructor rating  Intermediate │
│  UPCOMING QUIZ                │        ← BOTH shown, see §14     │
│  React Fundamentals · 20 min  ├──────────────────────────────────┤
│  opens in 1d                  │  UPCOMING DEADLINES              │
├───────────────────────────────┤  · Todo App        Thu 10:00     │
│  LATEST RECORDING             │  · React Quiz      Fri 15:00     │
│  Session 12 · yesterday       │  · Mini Project    Mon 09:00     │
│                               ├──────────────────────────────────┤
│  RECENT NOTES                 │  ANNOUNCEMENTS                   │
│  · Hooks Cheatsheet.pdf       │  · Batch shifted to 11:00 Fri    │
│  · Router v6 Guide.pdf        │  · New React notes uploaded      │
└───────────────────────────────┴──────────────────────────────────┘
```

**Continue Learning** resolves as: the most recent `ContentProgress.lastViewedAt` whose content is still visible and `completedAt IS NULL`. If everything viewed is complete, it advances to the first unstarted item in the lowest-position incomplete module. If nothing has been started, it shows the first item of module 1 as "Start Learning". Backed by the `@@index([studentId, lastViewedAt])`.

**Both progress figures are shown** (approved decision 2): the computed **Learning Progress** bars and the instructor's **manual rating**, clearly labelled as different things.

Mobile collapses to a single column with Continue Learning pinned first.

---

## 12. INSTRUCTOR DASHBOARD DESIGN

```
┌──────────────────────────────────────────────────────────────────┐
│  Good morning, Asha Rao              3 assigned batches          │
├───────────────────────────────┬──────────────────────────────────┤
│  TODAY'S SESSIONS             │  NEEDS EVALUATION           (12) │
│  10:00 React Hooks · 2026-A   │  · Todo App    · 2026-A ·  8 new │
│         [ Start Meet → ]      │  · React Quiz  · 2026-B ·  4 new │
│  14:00 Node Intro  · 2026-B   │  Oldest waiting: 3 days ⚠        │
│         [ Start Meet → ]      │            [ Open Queue → ]      │
├───────────────────────────────┼──────────────────────────────────┤
│  MY BATCHES                   │  STUDENTS NEEDING ATTENTION      │
│  2026-A  30 students   72% ██ │  · R. Kumar  · 40% · 3 missed    │
│  2026-B  28 students   65% ██ │  · P. Menon  · 45% · quiz failed │
│  2026-C  25 students   58% ██ │  · S. Iyer   · 50% · 2 overdue   │
├───────────────────────────────┴──────────────────────────────────┤
│  BATCH CURRICULUM              (read-only — admin authors it)    │
│  ▸ HTML  ▸ CSS  ▸ JavaScript  ▸ React ◂ current  ▸ Node          │
└──────────────────────────────────────────────────────────────────┘
```

Every panel is scoped by `instructorBatchIds`. The curriculum is **read-only** — no create, edit, reorder, upload or publish control is rendered, and the API would reject it regardless (§7).

The evaluation queue is the instructor's primary workspace: oldest-first, filterable by batch and activity, with marks + remarks inline.

---

## 13. FUTURE SCALABILITY

How each named future feature lands **without schema redesign**:

| Feature | What it needs | Already provided by |
|---|---|---|
| **AI Tutor** | Per-module context | `Module.aiMetadata` (Json) |
| **AI Quiz Generator** | Write quizzes programmatically | `Quiz`/`QuizQuestion`/`QuizOption` + `Activity.aiMetadata` for provenance |
| **AI Assignment Evaluator** | Suggest marks without overwriting the human | `Submission.aiEvaluation` (Json), structurally separate from `marks`/`remarks` |
| **AI Project Reviewer** | Same | Same |
| **Rubrics** | Criteria + per-criterion scores | `RubricCriterion` + `RubricScore` ship empty in Phase 2 |
| **Multiple attempts** | >1 attempt per activity | `Activity.maxAttempts` + `@@unique([activityId, studentId, attemptNumber])` |
| **Certificates** | Completion proof | Computed from `ContentProgress` + `ActivityProgress`; needs one `Certificate` table, no changes elsewhere |
| **Discussion forum** | Threads per entity | New tables only; `entityType`/`entityId` soft-reference pattern already established by `Notification` |
| **Curriculum versioning** | New syllabus, old batches unaffected | **`LearningPath` + clone** — the whole point of §3.2 |
| **Time-series analytics** | Views over time | Additive `ContentEvent` table; counters keep working |
| **Transactional email** | Replace Gmail | `NotificationDelivery.provider` is free text, not an enum |
| **Supabase storage** | Second provider | `StorageProvider` interface + `MediaAsset.provider` |
| **Enforced prerequisites** | Gate modules | `ModulePrerequisite` already stores the graph; add one check to the resolver |
| **Background jobs** | Reminders, retry sweeps, orphan collection | Every lazy path has a documented job-based equivalent; adding a scheduler changes call sites, never schema |

---

## 14. BACKWARD COMPATIBILITY REPORT

### 14.1 Guaranteed untouched

| Subsystem | Guarantee |
|---|---|
| **Authentication** | No change. JWT, `authenticate`, password gate, change-password, welcome flow |
| **Enrollment & Credentials** | No change. Enrollment, CSV import/export, credential tracking, reset flow, one-time disclosure, audit trail |
| **Attendance** | No change. `Attendance` model and all 5 endpoints |
| **Sessions & Google Meet** | No change. `Session`, `GoogleService`, Calendar/Meet flow |
| **Email transport** | **Extended, never modified.** SMTP → Gmail API fallback, circuit breaker, tokeninfo verification, diagnostics all untouched. Notifications *call* it |
| **`StudentProgress`** | **Untouched.** Instructor ratings, `/api/progress`, `AdminProgress`, `InstructorProgress`, `ProgressSliderDialog` all behave exactly as today |
| **`Batch.techStackId`** | **Kept required.** `LearningPath` is added alongside, so `POST/PATCH /batches` and `BatchFormDialog` are unaffected |
| **`express.json({limit:'10kb'})`** | Unchanged — signed direct uploads mean no file ever reaches the body parser |
| **Existing response shapes** | `/auth`, `/users`, `/sessions`, `/attendance`, `/progress`, `/techstacks`, `/batches` all unchanged (fields added only) |

### 14.2 What does change

| # | Change | Impact | Mitigation |
|---|---|---|---|
| 1 | **`POST /batches/:id/students` becomes a MOVE** | A student already in another batch is relocated instead of rejected | Approved (decision 1). UI relabelled **"Move Student to Batch"** with a confirmation naming the current batch. A `BATCH_TRANSFERRED` audit event is written |
| 2 | **`@@unique([studentId])` on StudentBatch** | Multi-batch students become impossible | Pre-flight gate (§5.2) blocks the migration until data is clean |
| 3 | **`GET /techstacks` / `/batches` gain fields** | Purely additive | Existing consumers ignore unknown fields |
| 4 | **`EnrollmentEventType` gains 2 values** | Additive; PostgreSQL enum additions are safe | Existing values untouched |

### 14.3 Student transfers preserve history (approved decision 12)

Transferring a student **moves one `StudentBatch` row.** Everything else is immutable history that survives untouched:

| Record | FKs to | Survives? | Why |
|---|---|---|---|
| `Submission` | Activity, User | ✅ | Never references a batch |
| `QuizAnswer`, `SubmissionArtifact`, `RubricScore` | Submission | ✅ | Cascade from a row that survives |
| `Attendance` | Session, User | ✅ | Old-batch sessions still exist |
| `ContentProgress` / `ActivityProgress` | Content/Activity, User | ✅ | Never reference a batch |
| `StudentProgress` (instructor rating) | TechStack, User | ✅ | Batch-independent |
| `EnrollmentEvent` | User | ✅ | Append-only; gains a `BATCH_TRANSFERRED` row |

**Only forward-looking visibility follows the new batch:** which sessions they attend, which batch-scoped content and activities they see, and which overrides apply.

**One consequence I want stated plainly, not buried.** If the new batch runs a **different LearningPath**, the student's completion percentage is recomputed against the new curriculum and *may drop* — because the requirements genuinely changed. Their old submissions and progress rows are not deleted; they simply no longer count toward a syllabus they are no longer on. Transferring between batches on the **same** path (the common case) has no such effect. The transfer confirmation dialog will state which case applies before the admin commits.

### 14.4 How compatibility is proven

- The existing suite (**134 tests**) must stay green at every phase gate.
- A written regression pass — enrollment → credential email → login → password change → session scheduling → attendance → instructor rating — before each phase ships.
- Migrations are additive; M1's backfill is the only data write and is discarded by dropping the column.

---

## 15. RISK ASSESSMENT

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| **R1** | **M2 fails on real data** — students in 2+ batches | 🔴 High | Pre-flight gate aborts with a CSV cleanup report (§5.2); M2 ships separately from M1; no auto-resolution |
| **R2** | **Quiz timer bypass** — tampered clock, closed tab, replayed request | 🔴 High | `expiresAt` stamped and checked server-side on every write; answers autosaved incrementally; expiry finalises lazily on read (§6.4) |
| **R3** | **Answer-key leakage** | 🔴 High | Stripped in `quiz.service.ts`, not a controller; a dedicated test asserts `isCorrect` never appears in a student payload |
| **R4** | **Notification fan-out cost** — a broadcast writes N recipient + N delivery rows | 🟠 Med | `createMany` batch insert; in-app default, email opt-in per type; `Notification` itself stays one row |
| **R5** | **Email retry never fires on an idle system** | 🟠 Med | Opportunistic flush + manual admin flush + visible failed count. **Accepted trade** for zero infrastructure (§8.3) |
| **R6** | **LearningPath divergence** — `batch.techStackId` disagreeing with `batch.learningPath.techStackId` | 🟠 Med | Service-layer invariant on every batch write; a consistency check in the pre-flight command |
| **R7** | **Transfer across differing paths silently changes completion %** | 🟠 Med | Stated in the transfer confirmation dialog (§14.3); history is never deleted |
| **R8** | **Storage cost / abuse** | 🟠 Med | Size + MIME caps enforced **at signing time**, before any byte uploads; per-submission artifact cap |
| **R9** | **Orphaned media** | 🟠 Med | `Restrict` on submission artifacts; admin-triggered sweep with a usage report |
| **R10** | **Pre-existing ownership gaps amplified** | 🟠 Med | Policy layer lands in Phase 1, before content exists to leak; closes the original audit's High finding |
| **R11** | **Analytics unbounded reads** | 🟠 Med | `groupBy` aggregates only, never row fetches; paginated from day one |
| **R12** | **Scope** — this brief is ~4× everything built so far | 🟠 Med | Hard phase gates; Phase 1 ships and stabilises alone |
| **R13** | **Testing debt** — 134 tests, none covering visibility or ownership | 🟠 Med | Visibility resolver, policy predicates and timer arithmetic are pure functions; all three get full unit cover in Phase 1 |
| **R14** | **Cloudinary free-tier limits** (25 GB storage / 25 GB monthly bandwidth) | 🟡 Low | Usage surfaced in admin storage report; provider swap is one adapter away |

---

## 16. PHASE 1 SCOPE — WHAT I WILL BUILD ON APPROVAL

**Database:** M1 + M2 (gated on pre-flight).

**Backend:** `LearningPath` CRUD + clone · `Module` CRUD + reorder + metadata + prerequisites · `Content` CRUD + reorder + publish + override · visibility resolver (unit-tested) · policy layer (unit-tested) · storage service + Cloudinary adapter + signed uploads · batch **move** semantics + transfer audit.

**Frontend:** admin Curriculum Builder (drag-and-drop modules and content) · Content library with upload · visibility/override picker · release scheduler · student read-only Module view · instructor read-only Batch Curriculum · "Move Student to Batch" dialog.

**Not in Phase 1:** activities, quizzes, submissions, evaluation, notifications, analytics, the new student dashboard. Those are Phases 2 and 3, in that order.

**Exit criteria:**
- An admin builds a complete MERN 2026 path and clones it to MERN 2027 with no migration.
- A student sees exactly their batch's published, released content — verified against override, inherit-and-add, and scheduled-release cases.
- An instructor sees their assigned batches only, with no edit affordance, and is rejected by the API if they try.
- Moving a student between batches preserves every historical record.
- 134 existing tests still green, plus new unit cover for the resolver and policy layer.

---

## APPROVAL

All 14 decisions are integrated. Two things I need before writing code:

1. **Confirm the Phase 1 scope in §16** is what you expect.
2. **One question §14.3 raises that only you can answer:** when a student transfers into a batch on a *different* LearningPath, should the system (a) recompute completion against the new path — my recommendation, and what this design does — or (b) keep them pinned to their original path until they graduate? Option (b) is implementable (it pins `learningPathId` on `StudentBatch` instead of reading it from `Batch`) but it means two students in one batch can see different curricula, which complicates every instructor view.

**Nothing else is blocking.** On your word I will begin Phase 1: M1, the pre-flight command, then backend before frontend.
