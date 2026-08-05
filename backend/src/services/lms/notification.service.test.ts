import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const sendEmail = vi.fn();
vi.mock('../email.service', () => ({
  EmailService: { send: (...args: unknown[]) => sendEmail(...args) },
}));

const { NotificationService } = await import('./notification.service');

const GLOBAL_CONTENT = {
  id: 'c1',
  title: 'React Hooks Deep Dive',
  type: 'PDF',
  status: 'PUBLISHED',
  scope: 'LEARNING_PATH',
  batchId: null,
  releaseAt: null,
  learningPathId: 'lp1',
  module: { id: 'm1', name: 'React' },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.content.findUnique.mockResolvedValue(GLOBAL_CONTENT);
  prismaMock.studentBatch.findMany.mockResolvedValue([
    { studentId: 's1' },
    { studentId: 's2' },
  ]);
  prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
  prismaMock.notification.findMany.mockResolvedValue([]);
  prismaMock.notificationRecipient.createMany.mockResolvedValue({ count: 2 });
  prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 2 });
  prismaMock.user.findMany.mockResolvedValue([
    { id: 's1', email: 's1@example.com' },
    { id: 's2', email: 's2@example.com' },
  ]);
  sendEmail.mockResolvedValue({ delivered: true });
});

describe('announceContentPublished — audience', () => {
  it('writes ONE notification and one thin row per student', async () => {
    await NotificationService.announceContentPublished('c1', 'admin1');

    // The two-tier point: the title/body is stored once, not per recipient.
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationRecipient.createMany).toHaveBeenCalledTimes(1);

    const rows = prismaMock.notificationRecipient.createMany.mock.calls[0]![0].data;
    expect(rows).toEqual([
      { notificationId: 'n1', userId: 's1' },
      { notificationId: 'n1', userId: 's2' },
    ]);
  });

  it('scopes a BATCH item to that batch alone, never the whole path', async () => {
    prismaMock.content.findUnique.mockResolvedValue({
      ...GLOBAL_CONTENT,
      scope: 'BATCH',
      batchId: 'b1',
    });

    await NotificationService.announceContentPublished('c1', null);

    // Querying by batchId — not by learningPathId, which would notify every
    // cohort about material only one of them can open.
    expect(prismaMock.studentBatch.findMany).toHaveBeenCalledWith({
      where: { batchId: 'b1' },
      select: { studentId: true },
    });
    expect(prismaMock.notification.create.mock.calls[0]![0].data.audience).toBe('BATCH');
  });

  it('resolves a global item to every batch running the path', async () => {
    await NotificationService.announceContentPublished('c1', null);

    expect(prismaMock.studentBatch.findMany).toHaveBeenCalledWith({
      where: { batch: { learningPathId: 'lp1' } },
      select: { studentId: true },
    });
  });

  it('deduplicates a student enrolled in two batches on the same path', async () => {
    prismaMock.studentBatch.findMany.mockResolvedValue([
      { studentId: 's1' },
      { studentId: 's1' },
      { studentId: 's2' },
    ]);

    await NotificationService.announceContentPublished('c1', null);

    const rows = prismaMock.notificationRecipient.createMany.mock.calls[0]![0].data;
    // Without the dedupe the unique index would reject the whole createMany.
    expect(rows).toHaveLength(2);
  });

  it('does nothing when nobody is enrolled', async () => {
    prismaMock.studentBatch.findMany.mockResolvedValue([]);

    const result = await NotificationService.announceContentPublished('c1', null);

    expect(result).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe('announceContentPublished — what must NOT be announced', () => {
  it('stays silent for a draft', async () => {
    prismaMock.content.findUnique.mockResolvedValue({ ...GLOBAL_CONTENT, status: 'DRAFT' });

    expect(await NotificationService.announceContentPublished('c1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('stays silent for a scheduled item whose moment has not arrived', async () => {
    prismaMock.content.findUnique.mockResolvedValue({
      ...GLOBAL_CONTENT,
      releaseAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Telling a student about something they cannot open is worse than silence.
    expect(await NotificationService.announceContentPublished('c1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('announces a scheduled item once its moment has passed', async () => {
    prismaMock.content.findUnique.mockResolvedValue({
      ...GLOBAL_CONTENT,
      releaseAt: new Date(Date.now() - 1000),
    });

    await NotificationService.announceContentPublished('c1', null);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe('announceDueReleases — lazy release, no cron', () => {
  it('skips items that were already announced', async () => {
    prismaMock.content.findMany.mockResolvedValue([
      { ...GLOBAL_CONTENT, id: 'c1' },
      { ...GLOBAL_CONTENT, id: 'c2' },
    ]);
    // c1 already has a notification row against it.
    prismaMock.notification.findMany.mockResolvedValue([{ entityId: 'c1' }]);

    const count = await NotificationService.announceDueReleases('lp1');

    expect(count).toBe(1);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create.mock.calls[0]![0].data.entityId).toBe('c2');
  });

  it('checks prior announcements in ONE query, not one per item', async () => {
    prismaMock.content.findMany.mockResolvedValue([
      { ...GLOBAL_CONTENT, id: 'c1' },
      { ...GLOBAL_CONTENT, id: 'c2' },
      { ...GLOBAL_CONTENT, id: 'c3' },
    ]);

    await NotificationService.announceDueReleases('lp1');

    // This runs on a student page load; a per-item lookup would be an N+1 on
    // the hottest read in the app.
    expect(prismaMock.notification.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns early without querying when nothing is due', async () => {
    prismaMock.content.findMany.mockResolvedValue([]);

    expect(await NotificationService.announceDueReleases('lp1')).toBe(0);
    expect(prismaMock.notification.findMany).not.toHaveBeenCalled();
  });
});

describe('email delivery is isolated from publishing', () => {
  it('records emailSentAt on success', async () => {
    await NotificationService.announceContentPublished('c1', null);

    const update = prismaMock.notificationRecipient.updateMany.mock.calls[0]![0];
    expect(update.data.emailSentAt).toBeInstanceOf(Date);
  });

  it('records the failure reason instead of throwing', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'SMTP unreachable' });

    // The content is already live; a mail outage must not surface as a failed
    // publish, or the admin retries and double-notifies everyone.
    await expect(NotificationService.announceContentPublished('c1', null)).resolves.toBeTruthy();

    const update = prismaMock.notificationRecipient.updateMany.mock.calls[0]![0];
    expect(update.data.emailFailureReason).toBe('SMTP unreachable');
    expect(update.data.emailSentAt).toBeUndefined();
  });

  it('still creates in-app notifications when there is nobody to email', async () => {
    prismaMock.user.findMany.mockResolvedValue([]); // e.g. all deactivated

    await NotificationService.announceContentPublished('c1', null);

    expect(prismaMock.notificationRecipient.createMany).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('escapes HTML in titles so content cannot inject markup into the email', async () => {
    prismaMock.content.findUnique.mockResolvedValue({
      ...GLOBAL_CONTENT,
      title: '<img src=x onerror="alert(1)">',
    });

    await NotificationService.announceContentPublished('c1', null);

    const message = sendEmail.mock.calls[0]![0];
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });
});

describe('read state', () => {
  it('scopes markRead by userId so one user cannot read another\'s row', async () => {
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 1 });

    await NotificationService.markRead('u1', 'r1');

    expect(prismaMock.notificationRecipient.updateMany.mock.calls[0]![0].where).toMatchObject({
      id: 'r1',
      userId: 'u1',
    });
  });

  it('throws 404 when the row is not this user\'s', async () => {
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.notificationRecipient.findFirst.mockResolvedValue(null);

    await expect(NotificationService.markRead('u1', 'r-other')).rejects.toThrow('Notification not found');
  });

  it('is idempotent for an already-read notification', async () => {
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.notificationRecipient.findFirst.mockResolvedValue({ id: 'r1' });

    await expect(NotificationService.markRead('u1', 'r1')).resolves.toBe(true);
  });
});
