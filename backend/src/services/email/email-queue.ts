import prisma from '../../config/db';
import { EmailService } from '../email.service';
import { isNetworkFailure, type EmailMessage, type SendResult } from './types';
import { limits } from '../../config/limits';
import { logger } from '../../utils/logger';

/**
 * In-process email queue.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Notification mail used to be awaited inline. Marking forty papers meant forty
 * sequential SMTP conversations inside the request, so the instructor watched a
 * spinner for a minute while work that had already been committed to the
 * database waited on a mail server. Enqueuing hands the request back
 * immediately; the in-app notification — the durable record — is already
 * written by then.
 *
 * ── DURABILITY: READ THIS BEFORE RELYING ON IT ───────────────────────────────
 * This queue is in MEMORY. A process restart or crash loses every job still
 * waiting, and nothing retries them afterwards. That is an accepted trade here
 * and only here: these emails are a courtesy copy of a NotificationRecipient
 * row that already exists and is already visible in the portal, so a lost job
 * costs a nudge, never the information. It would NOT be an acceptable trade for
 * enrollment credentials, which is why those still send inline through
 * EmailService directly.
 *
 * ── HOW TO MAKE IT DURABLE ───────────────────────────────────────────────────
 * Jobs are plain DATA — no closures, no live Prisma handles — precisely so that
 * swapping this for BullMQ/Redis is a transport change rather than a redesign:
 * replace `enqueue` with `queue.add(job)` and `processNext` with a Worker whose
 * body is `handle(job)` unchanged. The shape below is already serialisable.
 */

export interface EmailJob {
  /**
   * Every notification this one send covers, stamped with the outcome once it
   * settles. A list rather than a single id because a digest collapses several
   * notifications into one message — stamping those up front would record
   * "delivered" for a send that had not happened yet, and might not.
   *
   * Empty for mail with no NotificationRecipient behind it.
   */
  notificationIds: string[];
  userIds: string[];
  message: EmailMessage;
  /** Attempts made so far. Used for backoff; never persisted anywhere. */
  attempts?: number;
}

/**
 * Tunables live in config/limits.ts so an operator can change them from the
 * environment rather than from a redeploy. Defaults match the values these
 * were before Phase 7.
 */
const { maxAttempts: MAX_ATTEMPTS, retryBaseMs: RETRY_BASE_MS, queueMaxLength: MAX_QUEUE_LENGTH } =
  limits.email;

class EmailQueue {
  private jobs: EmailJob[] = [];
  private running = false;
  /** Resolves when the queue next reaches empty. Used by tests and shutdown. */
  private idleWaiters: (() => void)[] = [];

  /** Jobs waiting. Exposed for the admin health view and for tests. */
  get size(): number {
    return this.jobs.length;
  }

  /**
   * Adds a job and returns immediately. NEVER throws: a caller that has already
   * committed its database work must not fail because mail could not be queued.
   */
  enqueue(job: EmailJob): void {
    if (this.jobs.length >= MAX_QUEUE_LENGTH) {
      logger.error('Email queue full; dropping job', {
        capacity: MAX_QUEUE_LENGTH,
        label: job.message.label,
        recipients: job.userIds.length,
        // Stated on every drop so the line is actionable on its own: the
        // student still sees the notification in the portal.
        impact: 'in-app notifications unaffected',
      });
      return;
    }

    this.jobs.push(job);
    // setTimeout rather than await: control returns to the caller now, and the
    // send happens once the current request has finished with the event loop.
    setTimeout(() => void this.run(), 0);
  }

  private async run(): Promise<void> {
    if (this.running) return; // One at a time — see processNext.
    this.running = true;

    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!;
        await this.handle(job);
      }
    } finally {
      this.running = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  /**
   * Sends one job and records the outcome.
   *
   * Serial by construction. Sending in parallel would open one SMTP connection
   * per job against a provider that rate-limits them, turning a burst of
   * grading into a wave of throttling errors.
   */
  private async handle(job: EmailJob): Promise<void> {
    let result: SendResult;
    try {
      result = await EmailService.send(job.message);
    } catch (error: any) {
      // EmailService already swallows its own failures, so reaching here means
      // something unexpected. Treated as a failed send rather than allowed to
      // kill the loop and strand every job behind it.
      result = { delivered: false, reason: error?.message ?? 'Unexpected send error' };
    }

    // Retry ONLY transient failures. A rejected address, a bad credential or a
    // malformed message fails identically on the third attempt as on the first,
    // so retrying them just delays the moment an admin is told — and the
    // failure reason is the whole point of recording it.
    if (!result.delivered && isNetworkFailure(result.kind)) {
      const attempts = (job.attempts ?? 0) + 1;
      if (attempts < MAX_ATTEMPTS) {
        logger.warn('Transient email failure; will retry', {
          label: job.message.label,
          attempt: attempts,
          reason: result.reason,
        });
        setTimeout(
          () => this.enqueue({ ...job, attempts }),
          RETRY_BASE_MS * 2 ** (attempts - 1)
        );
        return;
      }
    }

    if (!result.delivered) {
      logger.error('Email permanently failed', {
        label: job.message.label,
        recipients: job.userIds.length,
        reason: result.reason,
        attempts: (job.attempts ?? 0) + 1,
      });
    }

    await this.recordOutcome(job, result);
  }

  /** Stamps the delivery result on the recipient rows, if there are any. */
  private async recordOutcome(
    job: EmailJob,
    result: { delivered: boolean; reason?: string }
  ): Promise<void> {
    if (job.notificationIds.length === 0 || job.userIds.length === 0) return;

    try {
      await prisma.notificationRecipient.updateMany({
        where: { notificationId: { in: job.notificationIds }, userId: { in: job.userIds } },
        data: result.delivered
          ? { emailSentAt: new Date() }
          : { emailFailureReason: (result.reason ?? 'Delivery failed').slice(0, 500) },
      });
    } catch (error: any) {
      // The mail outcome is bookkeeping. Losing it must not crash the worker.
      logger.error('Could not record email delivery outcome', {
        notificationIds: job.notificationIds.length,
        error: error?.message || String(error),
      });
    }
  }

  /**
   * Resolves once the queue is empty and idle.
   *
   * The test affordance that keeps production and test code on the SAME path —
   * the alternative is making the queue send synchronously under NODE_ENV=test,
   * which means the behaviour under test is not the behaviour that ships.
   * Also the hook a graceful shutdown should await before exiting.
   */
  async drain(): Promise<void> {
    if (this.jobs.length === 0 && !this.running) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /** Test helper: discards pending jobs so one spec cannot bleed into the next. */
  reset(): void {
    this.jobs = [];
  }
}

export const emailQueue = new EmailQueue();
