"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const SmtpMailer_1 = require("./email/SmtpMailer");
const GmailApiMailer_1 = require("./email/GmailApiMailer");
const types_1 = require("./email/types");
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
class EmailService {
    static transportMode() {
        const mode = (process.env.EMAIL_TRANSPORT || 'auto').toLowerCase();
        return mode === 'smtp' || mode === 'gmail_api' ? mode : 'auto';
    }
    /** Startup banner and reachability checks. Safe to call fire-and-forget. */
    static async runStartupDiagnostics() {
        const mode = this.transportMode();
        try {
            if (mode !== 'gmail_api')
                await SmtpMailer_1.SmtpMailer.runStartupDiagnostics();
            if (mode !== 'smtp')
                await GmailApiMailer_1.GmailApiMailer.runStartupDiagnostics();
        }
        catch (error) {
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
    /**
     * Sends one arbitrary message, honouring `perRecipient`.
     *
     * This is the seam other services (e.g. EnrollmentEmailService) compose with,
     * so transport selection, circuit breaking and failure logging stay in one
     * place rather than being reimplemented per message type. Like every public
     * method here it resolves rather than rejects.
     *
     * Returns true only if every recipient was dispatched without a thrown error.
     * Callers may use this for reporting; they must not fail a business
     * transaction on it.
     */
    static async send(message) {
        if (!message.to || message.to.length === 0) {
            console.warn(`[email] No recipients for ${message.label} — skipping.`);
            return { delivered: false, reason: 'No recipients' };
        }
        if (!message.perRecipient || message.to.length === 1) {
            return this.dispatch(message);
        }
        // Credential-bearing mail is sent one message per recipient so no recipient
        // ever learns another's address. Sequential, not parallel: the SMTP path
        // holds one connection at a time and the Gmail API is quota-limited.
        //
        // The aggregate result reports the FIRST failure — enough for an operator
        // to act on, without inventing a per-recipient result type no caller wants.
        let firstFailure = null;
        for (const recipient of message.to) {
            const result = await this.dispatch({ ...message, to: [recipient] });
            if (!result.delivered && !firstFailure)
                firstFailure = result;
        }
        return firstFailure ?? { delivered: true };
    }
    static async dispatch(message) {
        try {
            const mode = this.transportMode();
            if (mode === 'gmail_api') {
                return await GmailApiMailer_1.GmailApiMailer.send(message, 'EMAIL_TRANSPORT=gmail_api');
            }
            if (mode === 'smtp') {
                return await SmtpMailer_1.SmtpMailer.send(message);
            }
            const canFallBack = GmailApiMailer_1.GmailApiMailer.isConfigured();
            const result = await SmtpMailer_1.SmtpMailer.send(message, { fallbackAvailable: canFallBack });
            if (result.delivered || !canFallBack)
                return result;
            if (!(0, types_1.isNetworkFailure)(result.kind) && result.kind !== undefined && SmtpMailer_1.SmtpMailer.getConfig()) {
                // Configuration/content failure — do not paper over it.
                console.warn(`   ℹ️ Not retrying over the Gmail API: ${result.kind} is a configuration issue,`);
                console.warn('     not a network block. Fix the SMTP settings above.');
                (0, types_1.logUnaffected)(message);
                return result;
            }
            return await GmailApiMailer_1.GmailApiMailer.send(message, 'SMTP unreachable from this host (outbound port blocked)');
        }
        catch (error) {
            // Defensive only: both mailers handle their own failures.
            console.error(`[email] Unexpected error sending "${message.subject}":`, error?.message || error);
            return { delivered: false, reason: error?.message || 'Unexpected error while sending' };
        }
    }
    static formatDate(startTime) {
        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(startTime);
    }
    static async sendSessionNotification(emails, sessionTitle, startTime, meetLink, instructorName, batchName) {
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
    static async sendCancellationNotification(emails, sessionTitle, startTime, instructorName, batchName) {
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
    static async sendSessionUpdateNotification(emails, sessionTitle, startTime, meetLink, instructorName, batchName) {
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
exports.EmailService = EmailService;
