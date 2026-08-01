import prisma from '../config/db';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { AppError } from '../utils/AppError';
import { PasswordGeneratorService } from './password.service';
import { EnrollmentEmailService } from './enrollment-email.service';
import { EnrollmentHistoryService } from './enrollment-history.service';
import { USER_PUBLIC_SELECT } from './user.service';

const BCRYPT_ROUNDS = 10;

/**
 * Credential delivery tracking and remediation.
 *
 * The single most important constraint in this file: **the plaintext temporary
 * password is never persisted.** It is generated, hashed, handed to the email
 * layer, and dropped. Everything below is designed around that fact rather than
 * working against it.
 */

export interface DeliveryOutcome {
  delivered: boolean;
  reason?: string;
}

/** Audit wording for a reset, distinguishing the two admin actions. */
function sendEmailDetail(sendEmail: boolean): string {
  return sendEmail
    ? 'Password reset; new credentials queued for email delivery'
    : 'Password reset; credentials shown once for manual delivery (no email sent)';
}

export class CredentialService {
  /**
   * Records the outcome of a credential email against the user.
   *
   * Never throws — it is called from fire-and-forget paths where the account
   * already exists and the business transaction has already succeeded.
   *
   * `isRetry` distinguishes the enrollment send (attempt zero) from an
   * admin-triggered one, so `credentialRetryCount` counts remediation attempts
   * rather than total sends.
   */
  static async recordDeliveryOutcome(
    userId: string,
    outcome: DeliveryOutcome,
    options: { isRetry?: boolean; actorId?: string | null } = {}
  ): Promise<void> {
    const { isRetry = false, actorId = null } = options;

    try {
      if (outcome.delivered) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            // RESET_SENT distinguishes "we re-issued this credential" from
            // "this is the original enrollment credential". Both mean delivered;
            // only one means the user's previous password stopped working.
            credentialStatus: isRetry ? 'RESET_SENT' : 'SENT',
            credentialSentAt: new Date(),
            credentialFailureReason: null,
            ...(isRetry
              ? {
                  credentialRetryCount: { increment: 1 },
                  credentialLastRetryAt: new Date(),
                }
              : {}),
          },
        });

        await EnrollmentHistoryService.record({
          userId,
          type: 'CREDENTIAL_SENT',
          detail: isRetry ? 'New credentials emailed after a password reset' : null,
          actorId,
        });
        return;
      }

      const reason = outcome.reason || 'Delivery failed for an unknown reason';

      await prisma.user.update({
        where: { id: userId },
        data: {
          credentialStatus: 'FAILED',
          credentialFailureReason: reason.slice(0, 500),
          credentialRetryCount: { increment: 1 },
          credentialLastRetryAt: new Date(),
        },
      });

      await EnrollmentHistoryService.record({
        userId,
        type: 'CREDENTIAL_FAILED',
        detail: reason,
        actorId,
      });
    } catch (error: any) {
      console.error(
        `[credential] Failed to record delivery outcome for ${userId}:`,
        error?.message || error
      );
    }
  }

  /**
   * Sends an enrollment email and records the outcome in one step.
   * Used by single enrollment, bulk import, and password reset.
   */
  static async deliverAndRecord(
    user: { id: string; name: string; email: string; role: string },
    temporaryPassword: string,
    options: { isRetry?: boolean; actorId?: string | null } = {}
  ): Promise<DeliveryOutcome> {
    const role = user.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'STUDENT';

    const outcome = await EnrollmentEmailService.sendEnrollmentEmail(role, {
      name: user.name,
      email: user.email,
      temporaryPassword,
    });

    await this.recordDeliveryOutcome(user.id, outcome, options);
    return outcome;
  }

  /**
   * Mints a new temporary password for a user and puts them back into the
   * enrolled state.
   *
   * Shared by both admin reset actions; `sendEmail` is the only difference
   * between them:
   *
   *   sendEmail: true  → "Reset & Send New Credentials" — emails the credential,
   *                      status becomes RESET_SENT (or FAILED).
   *   sendEmail: false → "Reset Password" — nothing is emailed, status becomes
   *                      PENDING because delivery is now the admin's job.
   *
   * In both cases the plaintext is returned exactly once, to this caller, and is
   * never persisted. It exists so the admin can hand it over directly — which is
   * the entire point of the no-email variant.
   */
  static async resetCredentials(
    userId: string,
    actorId: string,
    options: { sendEmail: boolean }
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    if (!user) throw new AppError('User not found', 404);

    if (user.role === 'ADMIN' && user.id !== actorId) {
      // Resetting a peer admin's password is an account-takeover primitive.
      // Admins change their own password through the profile screen.
      throw new AppError("Another administrator's password cannot be reset from here.", 403);
    }

    const temporaryPassword = PasswordGeneratorService.generate();
    const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
        passwordChangedAt: null,
        // Cleared so the UI never shows a stale "delivered on <date>" against a
        // credential that has just been replaced.
        credentialStatus: 'PENDING',
        credentialFailureReason: null,
        credentialSentAt: null,
      },
    });

    await EnrollmentHistoryService.recordMany([
      {
        userId,
        type: 'PASSWORD_RESET',
        detail: sendEmailDetail(options.sendEmail),
        actorId,
      },
      {
        userId,
        type: 'CREDENTIAL_GENERATED',
        detail: options.sendEmail
          ? 'A new temporary password was generated'
          : 'A new temporary password was generated for manual delivery',
        actorId,
      },
    ]);

    let outcome: DeliveryOutcome = { delivered: false };
    if (options.sendEmail) {
      outcome = await this.deliverAndRecord(user, temporaryPassword, {
        isRetry: true,
        actorId,
      });
    }

    // Re-read so the caller sees whatever the delivery step just wrote.
    const fresh = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_PUBLIC_SELECT,
    });

    return {
      user: fresh,
      emailed: options.sendEmail,
      delivered: options.sendEmail ? outcome.delivered : false,
      failureReason: options.sendEmail ? outcome.reason : undefined,
      /**
       * Returned exactly once. Never persisted, never logged, and unreachable
       * from any read endpoint once this response is discarded.
       */
      temporaryPassword,
    };
  }

  /**
   * Aggregate metrics for the admin credential dashboard.
   *
   * Every number here corresponds to a filter the admin can actually navigate
   * to, so a count is never a dead end. Uses `count` aggregates rather than
   * fetching rows — these must stay cheap as the cohort grows.
   */
  static async getCredentialStats() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const learners: Prisma.EnumRoleFilter = { in: ['STUDENT', 'INSTRUCTOR'] };

    const [
      awaitingFirstLogin,
      awaitingPasswordChange,
      failed,
      recentlyEnrolledCount,
      inactive,
      recentlyEnrolled,
      failures,
    ] = await Promise.all([
      // Enrolled, active, and has literally never signed in.
      prisma.user.count({
        where: { role: learners, status: true, firstLoginAt: null },
      }),
      // Signed in (or not) but still carrying the temporary password.
      prisma.user.count({
        where: { role: learners, status: true, mustChangePassword: true },
      }),
      prisma.user.count({ where: { credentialStatus: 'FAILED' } }),
      prisma.user.count({ where: { role: learners, createdAt: { gte: since } } }),
      prisma.user.count({ where: { role: learners, status: false } }),
      prisma.user.findMany({
        where: { role: learners, createdAt: { gte: since } },
        select: USER_PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // The actionable list: who needs remediation right now.
      prisma.user.findMany({
        where: { credentialStatus: 'FAILED' },
        select: USER_PUBLIC_SELECT,
        orderBy: { credentialLastRetryAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      awaitingFirstLogin,
      awaitingPasswordChange,
      failed,
      recentlyEnrolledCount,
      inactive,
      recentlyEnrolled,
      failures,
      /**
       * Retained for backward compatibility with the previous dashboard shape.
       * `sent` now spans both SENT and RESET_SENT because, to a reader of this
       * number, "the credential reached them" is the same fact either way.
       */
      sent: await prisma.user.count({
        where: { credentialStatus: { in: ['SENT', 'RESET_SENT'] } },
      }),
      pending: await prisma.user.count({ where: { credentialStatus: 'PENDING' } }),
    };
  }

  /**
   * Activation / deactivation with an optional reason, recorded in the audit
   * trail. A no-op change returns early so the timeline is not padded with
   * events that changed nothing.
   */
  static async setStatus(userId: string, status: boolean, actorId: string, reason?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });

    if (!user) throw new AppError('User not found', 404);

    if (user.id === actorId && !status) {
      throw new AppError('You cannot deactivate your own account.', 400);
    }

    if (user.status === status) {
      return prisma.user.findUnique({ where: { id: userId }, select: USER_PUBLIC_SELECT });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status },
      select: USER_PUBLIC_SELECT,
    });

    await EnrollmentHistoryService.record({
      userId,
      type: status ? 'ACTIVATED' : 'DEACTIVATED',
      detail: reason?.trim() || null,
      actorId,
    });

    return updated;
  }
}
