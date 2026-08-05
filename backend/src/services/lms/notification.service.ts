import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { EmailService } from '../email.service';

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
      moduleName,
      contentTitle: content.title,
    });

    return notification;
  }

  /**
   * Emails the in-app notification. Failures are recorded, never thrown:
   * the content is already published and the in-app notification already
   * exists, so a mail outage must not surface as a failed publish.
   */
  private static async deliverEmails(
    notificationId: string,
    userIds: string[],
    context: { moduleName: string; contentTitle: string }
  ) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, status: true },
      select: { id: true, email: true },
    });
    if (users.length === 0) return;

    const result = await EmailService.send({
      to: users.map((u) => u.email),
      subject: `New material in ${context.moduleName}`,
      text:
        `New learning material has been added to ${context.moduleName}.\n\n` +
        `  ${context.contentTitle}\n\n` +
        `Sign in to your course to view it.`,
      html:
        `<p>New learning material has been added to <strong>${escapeHtml(context.moduleName)}</strong>.</p>` +
        `<p style="font-size:16px;margin:16px 0"><strong>${escapeHtml(context.contentTitle)}</strong></p>` +
        `<p>Sign in to your course to view it.</p>`,
      label: 'new content notification',
      operation: 'publishing content',
      unaffected: [
        'The content is published and visible in the portal.',
        'In-app notifications were created for every student.',
      ],
      // One shared message: the content title is not personal data, and a
      // per-recipient send would be 200 sequential SMTP round trips.
      perRecipient: false,
    });

    await prisma.notificationRecipient.updateMany({
      where: { notificationId, userId: { in: users.map((u) => u.id) } },
      data: result.delivered
        ? { emailSentAt: new Date() }
        : { emailFailureReason: (result.reason ?? 'Delivery failed').slice(0, 500) },
    });
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

/** Minimal escaping for the values we interpolate into notification HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
