"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const GmailSMTPProvider_1 = require("./email/GmailSMTPProvider");
const ResendProvider_1 = require("./email/ResendProvider");
class EmailService {
    static smtpProvider = null;
    static resendProvider = null;
    static initialize() {
        console.log('📧 Initializing Gmail SMTP Provider (Primary)');
        this.smtpProvider = new GmailSMTPProvider_1.GmailSMTPProvider();
        if (process.env.RESEND_API_KEY) {
            console.log('📧 Initializing Resend Provider (Fallback)');
            this.resendProvider = new ResendProvider_1.ResendProvider();
        }
    }
    static async executeWithFailover(options) {
        if (!this.smtpProvider) {
            this.initialize();
        }
        console.log('\n📧 Trying SMTP...');
        try {
            await this.smtpProvider.sendEmail(options);
            console.log('✅ SMTP Success');
            return;
        }
        catch (error) {
            console.error('❌ SMTP Failed:', error.message);
            if (!this.resendProvider) {
                console.error('❌ Email delivery failed using all providers (Resend not configured).');
                return;
            }
            console.log('📧 Retrying with Resend...');
            try {
                await this.resendProvider.sendEmail(options);
                console.log('✅ Resend Success');
                return;
            }
            catch (resendError) {
                console.error('❌ Resend Failed:', resendError.message);
                console.error('❌ Email delivery failed using all providers.');
                return;
            }
        }
    }
    static async sendSessionNotification(emails, sessionTitle, startTime, meetLink, instructorName, batchName) {
        if (!emails || emails.length === 0) {
            console.warn('⚠️ No recipients provided for session notification email.');
            return;
        }
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(startTime);
        const subject = `Upcoming Class: ${sessionTitle}`;
        const text = `
Hello,

You have a new class scheduled!

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${formattedDate}
Google Meet Link: ${meetLink}

Please ensure you join on time.

Best Regards,
Student Training Portal
    `;
        console.log(`Recipients: ${emails.length} users`);
        console.log(`Subject: ${subject}`);
        await this.executeWithFailover({ to: emails, subject, text });
    }
    static async sendCancellationNotification(emails, sessionTitle, startTime, instructorName, batchName) {
        if (!emails || emails.length === 0) {
            console.warn('⚠️ No recipients provided for cancellation email.');
            return;
        }
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(startTime);
        const subject = `CANCELLED: ${sessionTitle}`;
        const text = `
Hello,

Please note that the following class has been CANCELLED:

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${formattedDate}

You do not need to attend this session.

Best Regards,
Student Training Portal
    `;
        console.log(`Recipients: ${emails.length} users`);
        console.log(`Subject: ${subject}`);
        await this.executeWithFailover({ to: emails, subject, text });
    }
    static async sendSessionUpdateNotification(emails, sessionTitle, startTime, meetLink, instructorName, batchName) {
        if (!emails || emails.length === 0) {
            console.warn('⚠️ No recipients provided for update email.');
            return;
        }
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(startTime);
        const subject = `UPDATED: ${sessionTitle}`;
        const text = `
Hello,

Please note that the details for the following class have been UPDATED:

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${formattedDate}
Google Meet Link: ${meetLink}

Please check the portal for any additional changes and ensure you join on time.

Best Regards,
Student Training Portal
    `;
        console.log(`Recipients: ${emails.length} users`);
        console.log(`Subject: ${subject}`);
        await this.executeWithFailover({ to: emails, subject, text });
    }
}
exports.EmailService = EmailService;
// Initialize on load if env vars are present
EmailService.initialize();
