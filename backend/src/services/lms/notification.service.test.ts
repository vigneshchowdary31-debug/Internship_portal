import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const sendEmail = vi.fn();
vi.mock('../email.service', () => ({
  EmailService: { send: (...args: unknown[]) => sendEmail(...args) },
}));

const { NotificationService } = await import('./notification.service');
const { emailQueue } = await import('../email/email-queue');

/**
 * Phase 6: mail is QUEUED, not awaited. Draining is the affordance that keeps
 * these tests on the same code path production uses — the alternative, making
 * the queue send synchronously under NODE_ENV=test, would mean the behaviour
 * under test is not the behaviour that ships.
 */
const flushEmail = () => emailQueue.drain();

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
  emailQueue.reset();
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

    await flushEmail();
    const update = prismaMock.notificationRecipient.updateMany.mock.calls[0]![0];
    expect(update.data.emailSentAt).toBeInstanceOf(Date);
  });

  it('records the failure reason instead of throwing', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'SMTP unreachable' });

    // The content is already live; a mail outage must not surface as a failed
    // publish, or the admin retries and double-notifies everyone.
    await expect(NotificationService.announceContentPublished('c1', null)).resolves.toBeTruthy();

    await flushEmail();
    const update = prismaMock.notificationRecipient.updateMany.mock.calls[0]![0];
    expect(update.data.emailFailureReason).toBe('SMTP unreachable');
    expect(update.data.emailSentAt).toBeUndefined();
  });

  it('still creates in-app notifications when there is nobody to email', async () => {
    prismaMock.user.findMany.mockResolvedValue([]); // e.g. all deactivated

    await NotificationService.announceContentPublished('c1', null);

    expect(prismaMock.notificationRecipient.createMany).toHaveBeenCalledTimes(1);
    await flushEmail();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('escapes HTML in titles so content cannot inject markup into the email', async () => {
    prismaMock.content.findUnique.mockResolvedValue({
      ...GLOBAL_CONTENT,
      title: '<img src=x onerror="alert(1)">',
    });

    await NotificationService.announceContentPublished('c1', null);

    await flushEmail();
    const message = sendEmail.mock.calls[0]![0];
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });
});

// ---------------------------------------------------------------------------
// Assignments (Phase 3, M1)
// ---------------------------------------------------------------------------

const GLOBAL_ASSIGNMENT = {
  id: 'a1',
  title: 'Build a REST API',
  deadline: new Date('2026-09-01T18:30:00Z'),
  maxMarks: 100,
  isPublished: true,
  scope: 'LEARNING_PATH',
  batchId: null,
  learningPathId: 'lp1',
  module: { id: 'm1', name: 'Node', isVisible: true },
};

describe('announceAssignmentPublished — audience', () => {
  beforeEach(() => {
    prismaMock.assignment.findUnique.mockResolvedValue(GLOBAL_ASSIGNMENT);
  });

  it('writes ONE notification and one thin row per student', async () => {
    await NotificationService.announceAssignmentPublished('a1', 'admin1');

    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    const rows = prismaMock.notificationRecipient.createMany.mock.calls[0]![0].data;
    expect(rows).toEqual([
      { notificationId: 'n1', userId: 's1' },
      { notificationId: 'n1', userId: 's2' },
    ]);
  });

  it('uses the ASSIGNMENT_PUBLISHED type and links to the assignment', async () => {
    await NotificationService.announceAssignmentPublished('a1', 'admin1');

    const data = prismaMock.notification.create.mock.calls[0]![0].data;
    expect(data.type).toBe('ASSIGNMENT_PUBLISHED');
    expect(data.entityType).toBe('Assignment');
    expect(data.entityId).toBe('a1');
  });

  it('scopes batch work to that batch alone, never the whole path', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      ...GLOBAL_ASSIGNMENT,
      scope: 'BATCH',
      batchId: 'b1',
    });

    await NotificationService.announceAssignmentPublished('a1', null);

    // The SAME audience resolver the content fan-out uses — declaring the
    // audience twice is how a notification advertises work nobody can open.
    expect(prismaMock.studentBatch.findMany).toHaveBeenCalledWith({
      where: { batchId: 'b1' },
      select: { studentId: true },
    });
    expect(prismaMock.notification.create.mock.calls[0]![0].data.audience).toBe('BATCH');
  });

  it('resolves global work to every batch running the path', async () => {
    await NotificationService.announceAssignmentPublished('a1', null);

    expect(prismaMock.studentBatch.findMany).toHaveBeenCalledWith({
      where: { batch: { learningPathId: 'lp1' } },
      select: { studentId: true },
    });
  });

  it('does nothing when nobody is enrolled', async () => {
    prismaMock.studentBatch.findMany.mockResolvedValue([]);

    expect(await NotificationService.announceAssignmentPublished('a1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('states the deadline in the email', async () => {
    await NotificationService.announceAssignmentPublished('a1', null);

    await flushEmail();
    const message = sendEmail.mock.calls[0]![0];
    // Rendered in IST and labelled, so nobody has to guess the zone.
    expect(message.text).toContain('IST');
    expect(message.text).toContain('Marks: 100');
  });

  it('escapes HTML in the title', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      ...GLOBAL_ASSIGNMENT,
      title: '<img src=x onerror="alert(1)">',
    });

    await NotificationService.announceAssignmentPublished('a1', null);

    await flushEmail();
    const message = sendEmail.mock.calls[0]![0];
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });

  it('records the failure reason instead of throwing when mail fails', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'SMTP unreachable' });

    await expect(
      NotificationService.announceAssignmentPublished('a1', null)
    ).resolves.toBeTruthy();

    await flushEmail();
    const update = prismaMock.notificationRecipient.updateMany.mock.calls[0]![0];
    expect(update.data.emailFailureReason).toBe('SMTP unreachable');
  });
});

describe('announceAssignmentPublished — what must NOT be announced', () => {
  it('stays silent for a draft', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      ...GLOBAL_ASSIGNMENT,
      isPublished: false,
    });

    expect(await NotificationService.announceAssignmentPublished('a1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('stays silent for work inside a hidden module', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      ...GLOBAL_ASSIGNMENT,
      module: { id: 'm1', name: 'Node', isVisible: false },
    });

    // The resolver hides it, so announcing it would advertise something the
    // student cannot reach — the same rule the content path already follows.
    expect(await NotificationService.announceAssignmentPublished('a1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('throws 404 for an unknown assignment', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    await expect(NotificationService.announceAssignmentPublished('nope', null)).rejects.toThrow(
      'Assignment not found'
    );
  });
});

// ---------------------------------------------------------------------------
// Quizzes (Phase 3, M3)
// ---------------------------------------------------------------------------

const GLOBAL_QUIZ = {
  id: 'quiz1',
  title: 'React Fundamentals',
  timeLimit: 30,
  isPublished: true,
  scope: 'LEARNING_PATH',
  batchId: null,
  learningPathId: 'lp1',
  module: { id: 'm1', name: 'React', isVisible: true },
  _count: { questions: 10 },
};

describe('announceQuizPublished', () => {
  beforeEach(() => {
    prismaMock.quiz.findUnique.mockResolvedValue(GLOBAL_QUIZ);
  });

  it('writes ONE notification and one thin row per student', async () => {
    await NotificationService.announceQuizPublished('quiz1', 'admin1');

    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationRecipient.createMany.mock.calls[0]![0].data).toEqual([
      { notificationId: 'n1', userId: 's1' },
      { notificationId: 'n1', userId: 's2' },
    ]);
  });

  it('uses the QUIZ_PUBLISHED type and links to the quiz', async () => {
    await NotificationService.announceQuizPublished('quiz1', 'admin1');

    const data = prismaMock.notification.create.mock.calls[0]![0].data;
    expect(data.type).toBe('QUIZ_PUBLISHED');
    expect(data.entityType).toBe('Quiz');
    expect(data.entityId).toBe('quiz1');
  });

  it('scopes a batch quiz to that batch alone', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue({
      ...GLOBAL_QUIZ,
      scope: 'BATCH',
      batchId: 'b1',
    });

    await NotificationService.announceQuizPublished('quiz1', null);

    // Shares resolveAudience with the assignment and content fan-outs.
    expect(prismaMock.studentBatch.findMany).toHaveBeenCalledWith({
      where: { batchId: 'b1' },
      select: { studentId: true },
    });
    expect(prismaMock.notification.create.mock.calls[0]![0].data.audience).toBe('BATCH');
  });

  it('states the time limit and question count', async () => {
    await NotificationService.announceQuizPublished('quiz1', null);

    await flushEmail();
    const message = sendEmail.mock.calls[0]![0];
    expect(message.text).toContain('30 minutes');
    expect(message.text).toContain('Questions: 10');
  });

  it('does NOT leak any answer key into the notification', async () => {
    await NotificationService.announceQuizPublished('quiz1', null);

    // The quiz lookup selects no question rows at all — only their count.
    await flushEmail();
    const select = prismaMock.quiz.findUnique.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty('questions');
    expect(JSON.stringify(sendEmail.mock.calls[0]![0])).not.toContain('correctAnswer');
  });

  it('escapes HTML in the title', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue({
      ...GLOBAL_QUIZ,
      title: '<img src=x onerror="alert(1)">',
    });

    await NotificationService.announceQuizPublished('quiz1', null);

    await flushEmail();
    expect(sendEmail.mock.calls[0]![0].html).not.toContain('<img');
    expect(sendEmail.mock.calls[0]![0].html).toContain('&lt;img');
  });

  it('stays silent for a draft', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue({ ...GLOBAL_QUIZ, isPublished: false });

    expect(await NotificationService.announceQuizPublished('quiz1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('stays silent for a quiz in a hidden module', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue({
      ...GLOBAL_QUIZ,
      module: { id: 'm1', name: 'React', isVisible: false },
    });

    expect(await NotificationService.announceQuizPublished('quiz1', null)).toBeNull();
  });

  it('does nothing when nobody is enrolled', async () => {
    prismaMock.studentBatch.findMany.mockResolvedValue([]);

    expect(await NotificationService.announceQuizPublished('quiz1', null)).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('throws 404 for an unknown quiz', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(null);

    await expect(NotificationService.announceQuizPublished('nope', null)).rejects.toThrow(
      'Quiz not found'
    );
  });

  it('records the failure reason instead of throwing when mail fails', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'SMTP unreachable' });

    await expect(NotificationService.announceQuizPublished('quiz1', null)).resolves.toBeTruthy();
    await flushEmail();
    expect(prismaMock.notificationRecipient.updateMany.mock.calls[0]![0].data.emailFailureReason).toBe(
      'SMTP unreachable'
    );
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

// ---------------------------------------------------------------------------
// Bulk grading digest (Phase 6)
// ---------------------------------------------------------------------------

describe('announceSubmissionsEvaluated — digest', () => {
  const marked = (id: string, studentId: string, title: string, marks: number) => ({
    id,
    studentId,
    marks,
    assignment: {
      id: `a-${title}`,
      title,
      maxMarks: 100,
      learningPathId: 'lp1',
      module: { name: 'React' },
    },
  });

  beforeEach(() => {
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
    prismaMock.notificationRecipient.createMany.mockResolvedValue({ count: 0 });
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 0 });
  });

  it('sends ONE email to a student who had three assignments marked', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      marked('sub1', 's1', 'API', 80),
      marked('sub2', 's1', 'Essay', 70),
      marked('sub3', 's1', 'Quiz prep', 90),
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 's1', email: 's1@example.com', name: 'Asha' }]);

    await NotificationService.announceSubmissionsEvaluated(['sub1', 'sub2', 'sub3'], 'inst1');
    await flushEmail();

    // Three near-identical emails minutes apart is how a channel teaches people
    // to filter it.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0]![0];
    expect(message.subject).toBe('3 of your assignments have been marked');
    expect(message.text).toContain('API — 80/100');
    expect(message.text).toContain('Essay — 70/100');
    expect(message.text).toContain('Quiz prep — 90/100');
  });

  it('sends one email PER STUDENT, not one for the batch', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      marked('sub1', 's1', 'API', 80),
      marked('sub2', 's2', 'API', 55),
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', email: 's1@example.com', name: 'Asha' },
      { id: 's2', email: 's2@example.com', name: 'Bilal' },
    ]);

    await NotificationService.announceSubmissionsEvaluated(['sub1', 'sub2'], 'inst1');
    await flushEmail();

    expect(sendEmail).toHaveBeenCalledTimes(2);
    // A shared To: header would disclose one student's mark to another.
    expect(sendEmail.mock.calls[0]![0].to).toEqual(['s1@example.com']);
    expect(sendEmail.mock.calls[1]![0].to).toEqual(['s2@example.com']);
  });

  it('uses the singular subject when only one was marked', async () => {
    prismaMock.submission.findMany.mockResolvedValue([marked('sub1', 's1', 'API', 80)]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 's1', email: 's1@example.com', name: 'Asha' }]);

    await NotificationService.announceSubmissionsEvaluated(['sub1'], 'inst1');
    await flushEmail();

    expect(sendEmail.mock.calls[0]![0].subject).toBe(
      'Your assignment in React has been marked'
    );
  });

  it('still writes ONE in-app notification per submission', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      marked('sub1', 's1', 'API', 80),
      marked('sub2', 's1', 'Essay', 70),
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 's1', email: 's1@example.com', name: 'Asha' }]);

    await NotificationService.announceSubmissionsEvaluated(['sub1', 'sub2'], 'inst1');

    // Only the EMAIL is collapsed. Each in-app row links to a different
    // assignment, so collapsing those would cost the student the second link.
    const notifications = prismaMock.notification.createMany.mock.calls[0]![0].data;
    expect(notifications).toHaveLength(2);
    expect(notifications[0].entityId).toBe('sub1');
    expect(notifications[1].entityId).toBe('sub2');

    const recipients = prismaMock.notificationRecipient.createMany.mock.calls[0]![0].data;
    expect(recipients).toHaveLength(2);
    // Ids are generated up front so both tables go in with createMany.
    expect(recipients[0].notificationId).toBe(notifications[0].id);
  });

  it('writes both tables with createMany, not one insert per row', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      marked('sub1', 's1', 'API', 80),
      marked('sub2', 's2', 'API', 55),
    ]);
    prismaMock.user.findMany.mockResolvedValue([]);

    await NotificationService.announceSubmissionsEvaluated(['sub1', 'sub2'], 'inst1');

    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('skips submissions that were never actually marked', async () => {
    // The query filters on marks: not null, so a failed grade contributes
    // nothing — no notification, no line in anyone's digest.
    prismaMock.submission.findMany.mockResolvedValue([]);

    const result = await NotificationService.announceSubmissionsEvaluated(['sub1'], 'inst1');

    expect(result).toEqual({ notified: 0, students: 0 });
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('queries only for marked submissions', async () => {
    prismaMock.submission.findMany.mockResolvedValue([]);

    await NotificationService.announceSubmissionsEvaluated(['sub1'], 'inst1');

    expect(prismaMock.submission.findMany.mock.calls[0]![0].where).toEqual({
      id: { in: ['sub1'] },
      marks: { not: null },
    });
  });

  it('does nothing at all for an empty batch', async () => {
    const result = await NotificationService.announceSubmissionsEvaluated([], 'inst1');

    expect(result).toEqual({ notified: 0, students: 0 });
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('still records the in-app rows when a student has no active account', async () => {
    prismaMock.submission.findMany.mockResolvedValue([marked('sub1', 's1', 'API', 80)]);
    prismaMock.user.findMany.mockResolvedValue([]); // deactivated

    await NotificationService.announceSubmissionsEvaluated(['sub1'], 'inst1');
    await flushEmail();

    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('escapes HTML in assignment titles', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      marked('sub1', 's1', '<img src=x onerror="alert(1)">', 80),
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 's1', email: 's1@example.com', name: 'Asha' }]);

    await NotificationService.announceSubmissionsEvaluated(['sub1'], 'inst1');
    await flushEmail();

    expect(sendEmail.mock.calls[0]![0].html).not.toContain('<img');
    expect(sendEmail.mock.calls[0]![0].html).toContain('&lt;img');
  });
});
