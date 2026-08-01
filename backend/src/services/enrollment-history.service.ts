import prisma from '../config/db';
import { EnrollmentEventType } from '@prisma/client';

/**
 * Append-only audit trail for credential and access events.
 *
 * Two rules govern everything here:
 *
 *   1. **Recording never fails the caller.** `record()` swallows its own
 *      errors. An audit write failing must not roll back a password reset that
 *      already happened — a missing log line is far less harmful than a user
 *      left in an indeterminate state.
 *   2. **Nothing sensitive is written.** `detail` carries failure
 *      classifications and admin-supplied reasons only. No passwords, no
 *      tokens, no message bodies.
 */

export interface RecordEventInput {
  userId: string;
  type: EnrollmentEventType;
  /** Failure classification, deactivation reason, etc. Never a credential. */
  detail?: string | null;
  /** Admin who performed the action. Null for self-service and system events. */
  actorId?: string | null;
}

/**
 * Presentation metadata, kept server-side so every client renders the same
 * vocabulary. `icon` is a stable semantic key, not a component name — the
 * frontend maps it to whatever icon set it uses.
 */
const EVENT_META: Record<
  EnrollmentEventType,
  { label: string; tone: 'good' | 'bad' | 'neutral'; icon: string }
> = {
  ENROLLED: { label: 'Account created', tone: 'good', icon: 'user-plus' },
  CREDENTIAL_GENERATED: { label: 'Credential generated', tone: 'neutral', icon: 'key' },
  CREDENTIAL_SENT: { label: 'Credential delivered', tone: 'good', icon: 'mail-check' },
  CREDENTIAL_FAILED: { label: 'Credential delivery failed', tone: 'bad', icon: 'mail-x' },
  CREDENTIAL_RESEND_BLOCKED: { label: 'Resend blocked (legacy)', tone: 'bad', icon: 'ban' },
  PASSWORD_RESET: { label: 'Password reset by admin', tone: 'neutral', icon: 'rotate-ccw' },
  PASSWORD_CHANGED: { label: 'Password changed by user', tone: 'good', icon: 'shield-check' },
  FIRST_LOGIN: { label: 'First login', tone: 'good', icon: 'log-in' },
  ACTIVATED: { label: 'Account activated', tone: 'good', icon: 'power' },
  DEACTIVATED: { label: 'Account deactivated', tone: 'bad', icon: 'power-off' },
  PROFILE_UPDATED: { label: 'Profile updated', tone: 'neutral', icon: 'pencil' },
};

export class EnrollmentHistoryService {
  /**
   * Writes one audit event. Never throws.
   *
   * Safe to call with `void` from a fire-and-forget path.
   */
  static async record(input: RecordEventInput): Promise<void> {
    try {
      await prisma.enrollmentEvent.create({
        data: {
          userId: input.userId,
          type: input.type,
          // Bounded so a pathological provider error cannot bloat the row.
          detail: input.detail ? input.detail.slice(0, 500) : null,
          actorId: input.actorId || null,
        },
      });
    } catch (error: any) {
      console.error(
        `[audit] Failed to record ${input.type} for user ${input.userId}:`,
        error?.message || error
      );
    }
  }

  /** Records several events atomically-ish. Also never throws. */
  static async recordMany(inputs: RecordEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await prisma.enrollmentEvent.createMany({
        data: inputs.map((input) => ({
          userId: input.userId,
          type: input.type,
          detail: input.detail ? input.detail.slice(0, 500) : null,
          actorId: input.actorId || null,
        })),
      });
    } catch (error: any) {
      console.error('[audit] Failed to record a batch of events:', error?.message || error);
    }
  }

  /** One user's timeline, newest first. */
  static async listForUser(userId: string, limit = 100) {
    const events = await prisma.enrollmentEvent.findMany({
      where: { userId },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });

    return events.map((event) => ({
      id: event.id,
      type: event.type,
      label: EVENT_META[event.type]?.label ?? event.type,
      tone: EVENT_META[event.type]?.tone ?? 'neutral',
      icon: EVENT_META[event.type]?.icon ?? 'circle',
      detail: event.detail,
      actor: event.actor ? { id: event.actor.id, name: event.actor.name } : null,
      createdAt: event.createdAt,
    }));
  }
}
