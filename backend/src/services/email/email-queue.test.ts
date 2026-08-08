import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const sendEmail = vi.fn();
vi.mock('../email.service', () => ({
  EmailService: { send: (...args: unknown[]) => sendEmail(...args) },
}));

const { emailQueue } = await import('./email-queue');

/**
 * The queue's contract, stated as tests:
 *
 *   enqueue never blocks, never throws, and never loses the caller's work.
 *   Sends are serial. Transient failures retry; permanent ones are recorded.
 *
 * The durability limit — jobs live in memory and die with the process — is a
 * documented trade, not something a test can paper over. What IS testable is
 * that nothing upstream depends on a send succeeding, which is what makes that
 * trade acceptable.
 */

const job = (over: Record<string, unknown> = {}) => ({
  notificationIds: ['n1'],
  userIds: ['u1', 'u2'],
  message: {
    to: ['a@example.com', 'b@example.com'],
    subject: 'Marked',
    text: 'body',
    label: 'test',
    operation: 'testing',
    unaffected: [],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  emailQueue.reset();
  sendEmail.mockResolvedValue({ delivered: true });
  prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 2 });
});

describe('enqueue — hands control back immediately', () => {
  it('does not send during the enqueue call itself', () => {
    emailQueue.enqueue(job());

    // The whole point: the request returns without waiting for SMTP.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(emailQueue.size).toBe(1);
  });

  it('sends once the queue is drained', async () => {
    emailQueue.enqueue(job());
    await emailQueue.drain();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(emailQueue.size).toBe(0);
  });

  it('never throws, whatever the job', () => {
    // A caller that has already committed its database work must not fail
    // because mail could not be queued.
    expect(() => emailQueue.enqueue(job({ userIds: [] }))).not.toThrow();
  });

  it('drains cleanly when nothing was queued', async () => {
    await expect(emailQueue.drain()).resolves.toBeUndefined();
  });
});

describe('processing is serial', () => {
  it('sends queued jobs one at a time, in order', async () => {
    const order: string[] = [];
    let active = 0;
    let maxConcurrent = 0;

    sendEmail.mockImplementation(async (message: any) => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      order.push(message.subject);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return { delivered: true };
    });

    emailQueue.enqueue(job({ message: { ...job().message, subject: 'one' } }));
    emailQueue.enqueue(job({ message: { ...job().message, subject: 'two' } }));
    emailQueue.enqueue(job({ message: { ...job().message, subject: 'three' } }));
    await emailQueue.drain();

    // Parallel sends would open one SMTP connection per job against a provider
    // that rate-limits them — a burst of grading becomes a wave of throttling.
    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(['one', 'two', 'three']);
  });
});

describe('delivery outcome is recorded on the notification rows', () => {
  it('stamps emailSentAt on success', async () => {
    emailQueue.enqueue(job());
    await emailQueue.drain();

    const call = prismaMock.notificationRecipient.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ notificationId: { in: ['n1'] }, userId: { in: ['u1', 'u2'] } });
    expect(call.data.emailSentAt).toBeInstanceOf(Date);
  });

  it('stamps the failure reason on a permanent failure', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'Mailbox does not exist' });

    emailQueue.enqueue(job());
    await emailQueue.drain();

    expect(prismaMock.notificationRecipient.updateMany.mock.calls[0]![0].data.emailFailureReason).toBe(
      'Mailbox does not exist'
    );
  });

  it('stamps EVERY notification a digest job covers', async () => {
    // One send decides all of them, so all of them get the one outcome — and
    // only after it settles, never optimistically at enqueue time.
    emailQueue.enqueue(job({ notificationIds: ['n1', 'n2', 'n3'], userIds: ['u1'] }));
    await emailQueue.drain();

    expect(prismaMock.notificationRecipient.updateMany.mock.calls[0]![0].where).toEqual({
      notificationId: { in: ['n1', 'n2', 'n3'] },
      userId: { in: ['u1'] },
    });
  });

  it('skips the write for a job with no notification behind it', async () => {
    emailQueue.enqueue(job({ notificationIds: [] }));
    await emailQueue.drain();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationRecipient.updateMany).not.toHaveBeenCalled();
  });

  it('keeps draining when recording the outcome fails', async () => {
    prismaMock.notificationRecipient.updateMany.mockRejectedValue(new Error('db down'));

    emailQueue.enqueue(job());
    emailQueue.enqueue(job());

    // The outcome is bookkeeping; losing it must not strand every job behind it.
    await expect(emailQueue.drain()).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('treats an unexpected throw from the mailer as a failed send', async () => {
    sendEmail.mockRejectedValue(new Error('socket exploded'));

    emailQueue.enqueue(job());
    await emailQueue.drain();

    // Allowing it to propagate would kill the loop and strand the rest.
    expect(prismaMock.notificationRecipient.updateMany.mock.calls[0]![0].data.emailFailureReason).toBe(
      'socket exploded'
    );
  });
});

describe('retries', () => {
  it('does NOT retry a permanent failure', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'Invalid recipient' });

    emailQueue.enqueue(job());
    await emailQueue.drain();

    // A rejected address fails identically on the third attempt as the first;
    // retrying only delays telling an admin.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationRecipient.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network failure rather than recording it', async () => {
    sendEmail.mockResolvedValue({
      delivered: false,
      kind: 'CONNECTION_TIMEOUT',
      reason: 'timed out',
    });

    emailQueue.enqueue(job());
    await emailQueue.drain();

    // The retry is scheduled on a backoff timer, so the outcome is NOT written
    // yet — the job has not finished failing.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationRecipient.updateMany).not.toHaveBeenCalled();
  });
});

// --- Phase 7: overflow and shutdown -----------------------------------------

describe('overflow is shed, never allowed to exhaust memory', () => {
  it('drops jobs past capacity without throwing at the caller', async () => {
    const { limits } = await import('../../config/limits');
    const capacity = limits.email.queueMaxLength;

    // Nothing is sent until the event loop turns, so the queue fills first.
    for (let i = 0; i < capacity + 5; i++) {
      expect(() => emailQueue.enqueue(job())).not.toThrow();
    }

    // The caller's database work is already committed; shedding beats an
    // out-of-memory kill that would take the whole process with it.
    expect(emailQueue.size).toBe(capacity);
  });

  it('reports fullness so the health endpoint can surface it', async () => {
    const { limits } = await import('../../config/limits');

    for (let i = 0; i < limits.email.queueMaxLength; i++) emailQueue.enqueue(job());

    expect(emailQueue.size >= limits.email.queueMaxLength).toBe(true);
  });
});

describe('drain — the shutdown hook', () => {
  it('resolves only once every queued job has been sent', async () => {
    let sent = 0;
    sendEmail.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 2));
      sent++;
      return { delivered: true };
    });

    emailQueue.enqueue(job());
    emailQueue.enqueue(job());
    emailQueue.enqueue(job());

    await emailQueue.drain();

    // This is the guarantee shutdown relies on: exiting before it resolves
    // discards notification emails queued in the last seconds of a deploy.
    expect(sent).toBe(3);
    expect(emailQueue.size).toBe(0);
  });

  it('resolves immediately when there is nothing to do', async () => {
    const started = Date.now();
    await emailQueue.drain();
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('resolves even when every send fails', async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: 'refused' });

    emailQueue.enqueue(job());
    emailQueue.enqueue(job());

    // A wedged mail server must not hang a deploy forever.
    await expect(emailQueue.drain()).resolves.toBeUndefined();
    expect(emailQueue.size).toBe(0);
  });

  it('lets several waiters drain the same queue', async () => {
    emailQueue.enqueue(job());

    // Shutdown and a health probe can both be waiting; neither should hang.
    await expect(Promise.all([emailQueue.drain(), emailQueue.drain()])).resolves.toBeTruthy();
  });
});
