import crypto from 'crypto';
import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { emailQueue } from '../email/email-queue';

/**
 * Notification fan-out for curriculum events.
 *
 * Two tiers, matching the Phase 1 schema:
 *   - `Notification` — the event. Written ONCE regardless of audience size.
 *   - `NotificationRecipient` — one thin row per person, carrying read state.
 *
 * A 200-student batch announcement is therefore 1 + 200 rows rather than 200
 * copies of the title and body, and the student's unread badge is a count over
 * one index rather than a per-request union of batch/path/stack/role rules.
 *
 * EMAIL NEVER BLOCKS PUBLISHING. Delivery is attempted after the rows are
 * committed and its failure is recorded on the recipient row — the same
 * isolation the enrollment flow uses, and for the same reason: an SMTP outage
 * must not roll back an instructor's content going live.
 */

const NOTIFICATION_SELECT = {
  id: true,
  readAt: true,
  createdAt: true,
  notification: {
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      linkUrl: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      batch: { select: { id: true, name: true } },
    },
  },
};

/** Content type → the notification type that best describes it. */
function notificationTypeFor(contentType: string): 'NOTES_UPLOADED' | 'VIDEO_UPLOADED' | 'RECORDING_UPLOADED' {
  if (contentType === 'VIDEO') return 'VIDEO_UPLOADED';
  if (contentType === 'RECORDING') return 'RECORDING_UPLOADED';
  return 'NOTES_UPLOADED';
}

export class NotificationService {
  /**
   * Announces a newly published content item to the students who can see it.
   *
   * Audience is derived from the content's OWN visibility rather than
   * re-declared here — batch-scoped content notifies exactly that batch, global
   * content notifies every batch running the learning path. Deriving it twice
   * is how a notification eventually leaks the existence of material a student
   * cannot open.
   *
   * Scheduled content is deliberately NOT announced at publish time: a student
   * told about something they cannot yet open is worse than silence. The
   * announcement happens when the item actually becomes readable, which for a
   * lazily-released item is its releaseAt moment — see `announceDueReleases`.
   */
  static async announceContentPublished(contentId: string, actorId: string | null) {
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        scope: true,
        batchId: true,
        releaseAt: true,
        learningPathId: true,
        module: { select: { id: true, name: true } },
      },
    });

    if (!content) throw new AppError('Content not found', 404);
    if (content.status !== 'PUBLISHED') return null;

    // Not yet readable — announcing now would advertise a locked item.
    if (content.releaseAt && content.releaseAt.getTime() > Date.now()) return null;

    return this.fanOutForContent(content, actorId);
  }

  /**
   * Announces scheduled items whose release moment has arrived but which have
   * not been announced yet.
   *
   * Called opportunistically from the student curriculum read, keeping the
   * "no cron" rule: the first student to load the page after a release triggers
   * the announcement for everyone. Idempotent via the unique
   * (notificationId, userId) index plus the entity lookup below, so concurrent
   * readers cannot double-notify.
   */
  static async announceDueReleases(learningPathId: string, actorId: string | null = null) {
    const due = await prisma.content.findMany({
      where: {
        learningPathId,
        status: 'PUBLISHED',
        releaseAt: { not: null, lte: new Date() },
      },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        scope: true,
        batchId: true,
        releaseAt: true,
        learningPathId: true,
        module: { select: { id: true, name: true } },
      },
      take: 50,
    });

    if (due.length === 0) return 0;

    // Skip anything already announced. One query for the whole set rather than
    // one per item — this runs on a student page load.
    const announced = await prisma.notification.findMany({
      where: { entityType: 'Content', entityId: { in: due.map((c) => c.id) } },
      select: { entityId: true },
    });
    const seen = new Set(announced.map((a) => a.entityId));

    let count = 0;
    for (const content of due) {
      if (seen.has(content.id)) continue;
      await this.fanOutForContent(content, actorId);
      count++;
    }
    return count;
  }

  /** Students who should hear about this item, derived from its visibility. */
  private static async resolveAudience(content: {
    scope: string;
    batchId: string | null;
    learningPathId: string;
  }): Promise<{ userIds: string[]; batchId: string | null }> {
    if (content.scope === 'BATCH' && content.batchId) {
      const rows = await prisma.studentBatch.findMany({
        where: { batchId: content.batchId },
        select: { studentId: true },
      });
      return { userIds: rows.map((r) => r.studentId), batchId: content.batchId };
    }

    // Global item: everyone in every batch running this learning path.
    const rows = await prisma.studentBatch.findMany({
      where: { batch: { learningPathId: content.learningPathId } },
      select: { studentId: true },
    });
    return { userIds: [...new Set(rows.map((r) => r.studentId))], batchId: null };
  }

  private static async fanOutForContent(
    content: {
      id: string;
      title: string;
      type: string;
      scope: string;
      batchId: string | null;
      learningPathId: string;
      module: { id: string; name: string } | null;
    },
    actorId: string | null
  ) {
    const { userIds, batchId } = await this.resolveAudience(content);
    if (userIds.length === 0) return null;

    const moduleName = content.module?.name ?? 'your course';

    const notification = await prisma.notification.create({
      data: {
        type: notificationTypeFor(content.type),
        audience: content.scope === 'BATCH' ? 'BATCH' : 'LEARNING_PATH',
        title: `New material in ${moduleName}`,
        body: content.title,
        linkUrl: `/my-course?content=${content.id}`,
        entityType: 'Content',
        entityId: content.id,
        batchId,
        learningPathId: content.learningPathId,
        createdById: actorId,
      },
    });

    // skipDuplicates makes a concurrent second call a no-op rather than a crash.
    await prisma.notificationRecipient.createMany({
      data: userIds.map((userId) => ({ notificationId: notification.id, userId })),
      skipDuplicates: true,
    });

    // Deliberately not awaited inside a transaction — see class comment.
    await this.deliverEmails(notification.id, userIds, {
      subject: `New material in ${moduleName}`,
      text:
        `New learning material has been added to ${moduleName}.\n\n` +
        `  ${content.title}\n\n` +
        `Sign in to your course to view it.`,
      html:
        `<p>New learning material has been added to <strong>${escapeHtml(moduleName)}</strong>.</p>` +
        `<p style="font-size:16px;margin:16px 0"><strong>${escapeHtml(content.title)}</strong></p>` +
        `<p>Sign in to your course to view it.</p>`,
      label: 'new content notification',
      operation: 'publishing content',
      unaffected: [
        'The content is published and visible in the portal.',
        'In-app notifications were created for every student.',
      ],
    });

    return notification;
  }

  /**
   * Emails the in-app notification. Failures are recorded, never thrown:
   * the thing being announced is already published and the in-app notification
   * already exists, so a mail outage must not surface as a failed publish.
   *
   * The message is composed by the caller rather than here. When assignments
   * arrived (Phase 3) this was the difference between one generic sender and a
   * second copy of the recipient lookup, the deactivated-user filter and the
   * delivery-outcome write — all of which are the parts worth having once.
   */
  private static async deliverEmails(
    notificationId: string,
    userIds: string[],
    message: {
      subject: string;
      text: string;
      html: string;
      label: string;
      operation: string;
      unaffected: string[];
    }
  ) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, status: true },
      select: { id: true, email: true },
    });
    if (users.length === 0) return;

    // QUEUED, not awaited (Phase 6). The publish or the mark is already
    // committed by the time we get here, so the request has nothing left to
    // learn from the SMTP round trip — and waiting for it was what made
    // grading forty papers take a minute. The worker records emailSentAt /
    // emailFailureReason on the same recipient rows once the send settles.
    emailQueue.enqueue({
      notificationIds: [notificationId],
      userIds: users.map((u) => u.id),
      message: {
        to: users.map((u) => u.email),
        ...message,
        // One shared message: nothing in these bodies is personal data, and a
        // per-recipient send would be 200 sequential SMTP round trips.
        perRecipient: false,
      },
    });
  }

  // --- Assignments (Phase 3, M1) --------------------------------------------

  /**
   * Announces a newly published assignment to the students who can see it.
   *
   * Audience comes from `resolveAudience` — the same function the content
   * fan-out uses — so a batch-scoped assignment reaches exactly that batch and
   * a path-global one reaches every cohort running the path. Declaring the
   * audience separately here is how a notification eventually advertises work a
   * student cannot open.
   *
   * Returns null rather than throwing when the assignment is not actually
   * readable — still a draft, or sitting in a hidden module. This mirrors the
   * content rule: telling a student about something they cannot open is worse
   * than silence.
   */
  static async announceAssignmentPublished(assignmentId: string, actorId: string | null) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        title: true,
        deadline: true,
        maxMarks: true,
        isPublished: true,
        scope: true,
        batchId: true,
        learningPathId: true,
        module: { select: { id: true, name: true, isVisible: true } },
      },
    });

    if (!assignment) throw new AppError('Assignment not found', 404);
    if (!assignment.isPublished) return null;
    if (assignment.module && !assignment.module.isVisible) return null;

    const moduleName = assignment.module?.name ?? 'your course';
    const due = formatDeadline(assignment.deadline);

    return this.fanOutPublished({
      entity: assignment,
      entityType: 'Assignment',
      type: 'ASSIGNMENT_PUBLISHED',
      title: `New assignment in ${moduleName}`,
      body: `${assignment.title} — due ${due}`,
      linkUrl: `/my-course?assignment=${assignment.id}`,
      actorId,
      email: {
        subject: `New assignment in ${moduleName}`,
        text:
          `A new assignment has been set in ${moduleName}.\n\n` +
          `  ${assignment.title}\n` +
          `  Due: ${due}\n` +
          `  Marks: ${assignment.maxMarks}\n\n` +
          `Sign in to your course to view it.`,
        html:
          `<p>A new assignment has been set in <strong>${escapeHtml(moduleName)}</strong>.</p>` +
          `<p style="font-size:16px;margin:16px 0"><strong>${escapeHtml(assignment.title)}</strong></p>` +
          `<p>Due: <strong>${escapeHtml(due)}</strong><br/>Marks: ${assignment.maxMarks}</p>` +
          `<p>Sign in to your course to view it.</p>`,
        label: 'new assignment notification',
        operation: 'publishing an assignment',
        unaffected: [
          'The assignment is published and visible in the portal.',
          'In-app notifications were created for every student.',
        ],
      },
    });
  }

  // --- Quizzes (Phase 3, M3) ------------------------------------------------

  /**
   * Announces a newly published quiz to the students who can see it.
   *
   * Same shape and same guards as the assignment announcement — draft and
   * hidden-module quizzes stay silent — because a quiz is visible under exactly
   * the same rule. The two share `fanOutPublished` rather than each carrying
   * their own copy of the audience resolution and two-tier write.
   */
  static async announceQuizPublished(quizId: string, actorId: string | null) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        timeLimit: true,
        isPublished: true,
        scope: true,
        batchId: true,
        learningPathId: true,
        module: { select: { id: true, name: true, isVisible: true } },
        _count: { select: { questions: true } },
      },
    });

    if (!quiz) throw new AppError('Quiz not found', 404);
    if (!quiz.isPublished) return null;
    if (quiz.module && !quiz.module.isVisible) return null;

    const moduleName = quiz.module?.name ?? 'your course';
    const detail = `${quiz._count.questions} question(s), ${quiz.timeLimit} minutes`;

    return this.fanOutPublished({
      entity: quiz,
      entityType: 'Quiz',
      type: 'QUIZ_PUBLISHED',
      title: `New quiz in ${moduleName}`,
      body: `${quiz.title} — ${detail}`,
      linkUrl: `/my-course?quiz=${quiz.id}`,
      actorId,
      email: {
        subject: `New quiz in ${moduleName}`,
        text:
          `A new quiz is available in ${moduleName}.\n\n` +
          `  ${quiz.title}\n` +
          `  Questions: ${quiz._count.questions}\n` +
          `  Time limit: ${quiz.timeLimit} minutes\n\n` +
          `The timer starts when you begin, so sign in when you are ready.`,
        html:
          `<p>A new quiz is available in <strong>${escapeHtml(moduleName)}</strong>.</p>` +
          `<p style="font-size:16px;margin:16px 0"><strong>${escapeHtml(quiz.title)}</strong></p>` +
          `<p>Questions: ${quiz._count.questions}<br/>Time limit: <strong>${quiz.timeLimit} minutes</strong></p>` +
          `<p>The timer starts when you begin, so sign in when you are ready.</p>`,
        label: 'new quiz notification',
        operation: 'publishing a quiz',
        unaffected: [
          'The quiz is published and visible in the portal.',
          'In-app notifications were created for every student.',
        ],
      },
    });
  }

  /**
   * The shared publish fan-out for batch/path-scoped items.
   *
   * Audience comes from `resolveAudience`, so a batch-scoped item reaches
   * exactly that batch and a path-global one reaches every cohort running the
   * path. Extracted when quizzes arrived (M3) rather than copied: the audience
   * derivation is the part that leaks material if it ever disagrees with the
   * visibility rule, and it should exist once.
   */
  private static async fanOutPublished(params: {
    entity: { id: string; scope: string; batchId: string | null; learningPathId: string };
    entityType: string;
    type: 'ASSIGNMENT_PUBLISHED' | 'QUIZ_PUBLISHED';
    title: string;
    body: string;
    linkUrl: string;
    actorId: string | null;
    email: {
      subject: string;
      text: string;
      html: string;
      label: string;
      operation: string;
      unaffected: string[];
    };
  }) {
    const { userIds, batchId } = await this.resolveAudience(params.entity);
    if (userIds.length === 0) return null;

    const notification = await prisma.notification.create({
      data: {
        type: params.type,
        audience: params.entity.scope === 'BATCH' ? 'BATCH' : 'LEARNING_PATH',
        title: params.title,
        body: params.body,
        linkUrl: params.linkUrl,
        entityType: params.entityType,
        entityId: params.entity.id,
        batchId,
        learningPathId: params.entity.learningPathId,
        createdById: params.actorId,
      },
    });

    await prisma.notificationRecipient.createMany({
      data: userIds.map((userId) => ({ notificationId: notification.id, userId })),
      skipDuplicates: true,
    });

    await this.deliverEmails(notification.id, userIds, params.email);

    return notification;
  }

  // --- Submissions (Phase 3, M2) -------------------------------------------

  /**
   * Tells one student their work has been marked.
   *
   * The only INDIVIDUAL-audience notification in the LMS, so it does not use
   * `resolveAudience` — the audience is exactly one person and deriving it from
   * batch membership would be a longer way to reach the same row. Everything
   * downstream of the audience (the two-tier write, the delivery-outcome
   * recording) is the shared path.
   *
   * The mark itself IS included: a notification that says only "your work was
   * marked" makes every student open the portal to learn one number.
   */
  static async announceSubmissionEvaluated(submissionId: string, actorId: string | null) {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        studentId: true,
        marks: true,
        assignment: {
          select: {
            id: true,
            title: true,
            maxMarks: true,
            learningPathId: true,
            module: { select: { name: true } },
          },
        },
      },
    });

    if (!submission) throw new AppError('Submission not found', 404);
    if (submission.marks === null) return null;

    const { assignment } = submission;
    const moduleName = assignment.module?.name ?? 'your course';
    const score = `${submission.marks}/${assignment.maxMarks}`;

    const notification = await prisma.notification.create({
      data: {
        type: 'ASSIGNMENT_EVALUATED',
        audience: 'INDIVIDUAL',
        title: `Your assignment has been marked`,
        body: `${assignment.title} — ${score}`,
        linkUrl: `/my-course?assignment=${assignment.id}`,
        entityType: 'Submission',
        entityId: submission.id,
        learningPathId: assignment.learningPathId,
        createdById: actorId,
      },
    });

    await prisma.notificationRecipient.createMany({
      data: [{ notificationId: notification.id, userId: submission.studentId }],
      skipDuplicates: true,
    });

    await this.deliverEmails(notification.id, [submission.studentId], {
      subject: `Your assignment in ${moduleName} has been marked`,
      text:
        `Your submission has been marked.\n\n` +
        `  ${assignment.title}\n` +
        `  Score: ${score}\n\n` +
        `Sign in to your course to read the feedback.`,
      html:
        `<p>Your submission has been marked.</p>` +
        `<p style="font-size:16px;margin:16px 0"><strong>${escapeHtml(assignment.title)}</strong></p>` +
        `<p>Score: <strong>${escapeHtml(score)}</strong></p>` +
        `<p>Sign in to your course to read the feedback.</p>`,
      label: 'assignment evaluated notification',
      operation: 'marking a submission',
      unaffected: [
        'The mark and feedback are saved and visible in the portal.',
        'An in-app notification was created for the student.',
      ],
    });

    return notification;
  }

  /**
   * Announces a whole batch of marked submissions (Phase 6).
   *
   * ── ONE EMAIL PER STUDENT, NOT PER SUBMISSION ────────────────────────────
   * Marking forty papers used to send forty emails. Where one student had three
   * assignments marked in the same sitting, they received three near-identical
   * messages minutes apart — which is how a notification channel teaches people
   * to filter it. This groups by student and sends a single digest listing
   * everything that was marked.
   *
   * The IN-APP notifications stay one-per-submission. They are the durable
   * record and each one links to a different assignment; collapsing those would
   * mean a student could not click through to the second result. Only the email
   * is collapsed, and it is cheap to collapse because it is a courtesy copy.
   *
   * Ids are generated here rather than left to the database so both tables can
   * be written with `createMany` — two statements for forty notifications
   * instead of eighty round trips.
   */
  static async announceSubmissionsEvaluated(submissionIds: string[], actorId: string | null) {
    if (submissionIds.length === 0) return { notified: 0, students: 0 };

    const submissions = await prisma.submission.findMany({
      where: { id: { in: submissionIds }, marks: { not: null } },
      select: {
        id: true,
        studentId: true,
        marks: true,
        assignment: {
          select: {
            id: true,
            title: true,
            maxMarks: true,
            learningPathId: true,
            module: { select: { name: true } },
          },
        },
      },
    });

    if (submissions.length === 0) return { notified: 0, students: 0 };

    const rows = submissions.map((submission) => ({
      id: crypto.randomUUID(),
      submission,
    }));

    await prisma.notification.createMany({
      data: rows.map(({ id, submission }) => ({
        id,
        type: 'ASSIGNMENT_EVALUATED' as const,
        audience: 'INDIVIDUAL' as const,
        title: 'Your assignment has been marked',
        body: `${submission.assignment.title} — ${submission.marks}/${submission.assignment.maxMarks}`,
        linkUrl: `/my-course?assignment=${submission.assignment.id}`,
        entityType: 'Submission',
        entityId: submission.id,
        learningPathId: submission.assignment.learningPathId,
        createdById: actorId,
      })),
      skipDuplicates: true,
    });

    await prisma.notificationRecipient.createMany({
      data: rows.map(({ id, submission }) => ({
        notificationId: id,
        userId: submission.studentId,
      })),
      skipDuplicates: true,
    });

    await this.deliverDigests(rows);

    return { notified: submissions.length, students: new Set(submissions.map((s) => s.studentId)).size };
  }

  /** Groups the marked work by student and queues one message each. */
  private static async deliverDigests(
    rows: {
      id: string;
      submission: {
        studentId: string;
        marks: number | null;
        assignment: { title: string; maxMarks: number; module: { name: string } | null };
      };
    }[]
  ) {
    const byStudent = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byStudent.get(row.submission.studentId) ?? [];
      list.push(row);
      byStudent.set(row.submission.studentId, list);
    }

    // Deactivated accounts are excluded here, once, rather than per message.
    const users = await prisma.user.findMany({
      where: { id: { in: [...byStudent.keys()] }, status: true },
      select: { id: true, email: true, name: true },
    });

    for (const user of users) {
      const items = byStudent.get(user.id);
      if (!items || items.length === 0) continue;

      const lines = items.map(({ submission }) => ({
        title: submission.assignment.title,
        moduleName: submission.assignment.module?.name ?? 'your course',
        score: `${submission.marks}/${submission.assignment.maxMarks}`,
      }));

      const subject =
        lines.length === 1
          ? `Your assignment in ${lines[0].moduleName} has been marked`
          : `${lines.length} of your assignments have been marked`;

      emailQueue.enqueue({
        // Every notification in this student's digest carries the one outcome,
        // because one send is what decides all of them. Stamped by the worker
        // AFTER the send settles, never optimistically.
        notificationIds: items.map((i) => i.id),
        userIds: [user.id],
        message: {
          to: [user.email],
          subject,
          text:
            `${lines.length === 1 ? 'Your submission has' : 'Your submissions have'} been marked.\n\n` +
            lines.map((l) => `  ${l.title} — ${l.score}`).join('\n') +
            `\n\nSign in to your course to read the feedback.`,
          html:
            `<p>${lines.length === 1 ? 'Your submission has' : 'Your submissions have'} been marked.</p>` +
            `<ul>${lines
              .map(
                (l) =>
                  `<li><strong>${escapeHtml(l.title)}</strong> — ${escapeHtml(l.score)}</li>`
              )
              .join('')}</ul>` +
            `<p>Sign in to your course to read the feedback.</p>`,
          label: 'grading digest',
          operation: 'marking submissions',
          unaffected: [
            'Every mark and comment is saved and visible in the portal.',
            'In-app notifications were created for each marked submission.',
          ],
          perRecipient: false,
        },
      });
    }

    // Nothing is stamped here. The worker records the real outcome against
    // every notification the job carries, once the send has actually settled —
    // writing `emailSentAt` up front would claim a delivery that has not
    // happened yet and might never.
  }

  // --- Reads ---------------------------------------------------------------

  static async listForUser(userId: string, options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));

    const where = { userId, ...(options.unreadOnly ? { readAt: null } : {}) };

    const [items, total, unread] = await Promise.all([
      prisma.notificationRecipient.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notificationRecipient.count({ where }),
      prisma.notificationRecipient.count({ where: { userId, readAt: null } }),
    ]);

    return { items, total, unread, page, pageSize, hasMore: page * pageSize < total };
  }

  static async unreadCount(userId: string) {
    return prisma.notificationRecipient.count({ where: { userId, readAt: null } });
  }

  /** Scoped by userId so one user can never mark another's notification read. */
  static async markRead(userId: string, recipientId: string) {
    const updated = await prisma.notificationRecipient.updateMany({
      where: { id: recipientId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      // Already read, or not this user's row. Both are non-errors for an
      // idempotent "mark read", but a missing row is worth distinguishing.
      const exists = await prisma.notificationRecipient.findFirst({
        where: { id: recipientId, userId },
        select: { id: true },
      });
      if (!exists) throw new AppError('Notification not found', 404);
    }
    return true;
  }

  static async markAllRead(userId: string) {
    const { count } = await prisma.notificationRecipient.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}

/**
 * Deadlines in notifications are rendered in IST and labelled as such.
 *
 * The alternative — the server's own locale — silently changes meaning when the
 * host moves region, and a bare ISO string in an email reads as a machine
 * artefact. The zone is stated in the output so nobody has to guess.
 */
function formatDeadline(deadline: Date): string {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(deadline);
  return `${formatted} IST`;
}

/** Minimal escaping for the values we interpolate into notification HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
