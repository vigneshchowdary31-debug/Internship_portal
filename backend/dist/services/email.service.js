"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const SmtpMailer_1 = require("./email/SmtpMailer");
/**
 * Email notifications for session lifecycle events.
 *
 * Delivery is SMTP-only and strictly best-effort. Every public method resolves,
 * never rejects, so a mail failure can never reach the caller's request path.
 */
class EmailService {
    /** Startup banner and SMTP reachability check. Safe to call fire-and-forget. */
    static async runStartupDiagnostics() {
        try {
            await SmtpMailer_1.SmtpMailer.runStartupDiagnostics();
        }
        catch (error) {
            console.error('[email] Startup diagnostics failed:', error?.message || error);
        }
    }
    static async dispatch(message) {
        try {
            await SmtpMailer_1.SmtpMailer.send(message);
        }
        catch (error) {
            // Defensive only: SmtpMailer.send already handles its own failures.
            console.error(`[email] Unexpected error sending "${message.subject}":`, error?.message || error);
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
