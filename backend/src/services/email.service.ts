import { SmtpMailer } from './email/SmtpMailer';
import { GmailApiMailer } from './email/GmailApiMailer';
import { isNetworkFailure, logUnaffected, type EmailMessage } from './email/types';

/**
 * Email notifications for session lifecycle events.
 *
 * Two transports carry the same message:
 *   - SMTP (nodemailer, port 587/465) — the default, used everywhere it works.
 *   - Gmail API (HTTPS/443) — used where the host firewalls outbound SMTP,
 *     e.g. Render's free instances.
 *
 * Both speak to the same Gmail account; this is transport selection, not a
 * second email vendor. EMAIL_TRANSPORT pins one explicitly:
 *   auto (default) | smtp | gmail_api
 *
 * Delivery is strictly best-effort. Every public method resolves, never
 * rejects, so a mail failure can never reach the caller's request path.
 */
export class EmailService {
  private static transportMode(): 'auto' | 'smtp' | 'gmail_api' {
    const mode = (process.env.EMAIL_TRANSPORT || 'auto').toLowerCase();
    return mode === 'smtp' || mode === 'gmail_api' ? mode : 'auto';
  }

  /** Startup banner and reachability checks. Safe to call fire-and-forget. */
  static async runStartupDiagnostics(): Promise<void> {
    const mode = this.transportMode();
    try {
      if (mode !== 'gmail_api') await SmtpMailer.runStartupDiagnostics();
      if (mode !== 'smtp') await GmailApiMailer.runStartupDiagnostics();
    } catch (error: any) {
      console.error('[email] Startup diagnostics failed:', error?.message || error);
    }
  }

  /**
   * Routes one message to a transport.
   *
   * In `auto`, SMTP is tried first and the Gmail API takes over only when the
   * failure is network-level (blocked port / no route). An auth, TLS or
   * recipient error is a configuration problem — masking it behind a second
   * transport would hide a bug that needs fixing.
   */
  private static async dispatch(message: EmailMessage): Promise<void> {
    try {
      const mode = this.transportMode();

      if (mode === 'gmail_api') {
        await GmailApiMailer.send(message, 'EMAIL_TRANSPORT=gmail_api');
        return;
      }
      if (mode === 'smtp') {
        await SmtpMailer.send(message);
        return;
      }

      const canFallBack = GmailApiMailer.isConfigured();
      const result = await SmtpMailer.send(message, { fallbackAvailable: canFallBack });
      if (result.delivered || !canFallBack) return;

      if (!isNetworkFailure(result.kind) && result.kind !== undefined && SmtpMailer.getConfig()) {
        // Configuration/content failure — do not paper over it.
        console.warn(`   ℹ️ Not retrying over the Gmail API: ${result.kind} is a configuration issue,`);
        console.warn('     not a network block. Fix the SMTP settings above.');
        logUnaffected(message);
        return;
      }

      await GmailApiMailer.send(message, 'SMTP unreachable from this host (outbound port blocked)');
    } catch (error: any) {
      // Defensive only: both mailers handle their own failures.
      console.error(`[email] Unexpected error sending "${message.subject}":`, error?.message || error);
    }
  }

  private static formatDate(startTime: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(startTime);
  }

  static async sendSessionNotification(
    emails: string[],
    sessionTitle: string,
    startTime: Date,
    meetLink: string,
    instructorName: string,
    batchName: string
  ) {
    if (!emails || emails.length === 0) {
      console.warn('[email] No recipients for session notification — skipping.');
      return;
    }

    await this.dispatch({
      to: emails,
      subject: `Upcoming Class: ${sessionTitle}`,
      text: `
Hello,

You have a new class scheduled!

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${this.formatDate(startTime)}
Google Meet Link: ${meetLink}

Please ensure you join on time.

Best Regards,
Student Training Portal
    `,
      label: 'session notification',
      operation: 'session creation',
      unaffected: [
        'Google Meet has already been created successfully.',
        'Google Calendar has already been updated successfully.',
        'The session has already been saved to the database.',
      ],
    });
  }

  static async sendCancellationNotification(
    emails: string[],
    sessionTitle: string,
    startTime: Date,
    instructorName: string,
    batchName: string
  ) {
    if (!emails || emails.length === 0) {
      console.warn('[email] No recipients for cancellation notification — skipping.');
      return;
    }

    await this.dispatch({
      to: emails,
      subject: `CANCELLED: ${sessionTitle}`,
      text: `
Hello,

Please note that the following class has been CANCELLED:

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${this.formatDate(startTime)}

You do not need to attend this session.

Best Regards,
Student Training Portal
    `,
      label: 'cancellation notification',
      operation: 'session cancellation',
      unaffected: [
        'The Google Calendar event has already been removed successfully.',
        'The session has already been marked CANCELLED in the database.',
      ],
    });
  }

  static async sendSessionUpdateNotification(
    emails: string[],
    sessionTitle: string,
    startTime: Date,
    meetLink: string,
    instructorName: string,
    batchName: string
  ) {
    if (!emails || emails.length === 0) {
      console.warn('[email] No recipients for update notification — skipping.');
      return;
    }

    await this.dispatch({
      to: emails,
      subject: `UPDATED: ${sessionTitle}`,
      text: `
Hello,

Please note that the details for the following class have been UPDATED:

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${this.formatDate(startTime)}
Google Meet Link: ${meetLink}

Please check the portal for any additional changes and ensure you join on time.

Best Regards,
Student Training Portal
    `,
      label: 'session update notification',
      operation: 'the session update',
      unaffected: [
        'Google Calendar has already been updated successfully.',
        'The session changes have already been saved to the database.',
      ],
    });
  }
}
