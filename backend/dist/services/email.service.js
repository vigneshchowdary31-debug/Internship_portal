"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
class EmailService {
    static getTransporter() {
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!user || !pass) {
            console.warn('⚠️ SMTP credentials not provided. Emails will be logged to console instead.');
            return null;
        }
        return nodemailer_1.default.createTransport({
            service: 'gmail', // Assuming gmail per instructions
            auth: {
                user,
                pass,
            },
        });
    }
    static async sendSessionNotification(emails, sessionTitle, startTime, meetLink) {
        const transporter = this.getTransporter();
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(startTime);
        const subject = `Upcoming Class: ${sessionTitle}`;
        const text = `
Hello,

You have a new class scheduled!

Title: ${sessionTitle}
Date & Time: ${formattedDate}
Google Meet Link: ${meetLink}

Please ensure you join on time.

Best Regards,
Student Training Portal
    `;
        if (!transporter) {
            console.log(`\n📧 MOCK EMAIL DISPATCHED to ${emails.length} recipients`);
            console.log(`Subject: ${subject}`);
            console.log(`Body: \n${text}\n`);
            return;
        }
        try {
            await transporter.sendMail({
                from: `"Student Training Portal" <${process.env.SMTP_USER}>`,
                to: emails.join(', '),
                subject,
                text,
            });
            console.log('✅ Session notification emails sent successfully.');
        }
        catch (error) {
            console.error('❌ Failed to send session notification emails:', error);
        }
    }
    static async sendCancellationNotification(emails, sessionTitle, startTime) {
        const transporter = this.getTransporter();
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(startTime);
        const subject = `CANCELLED: ${sessionTitle}`;
        const text = `
Hello,

Please note that the following class has been CANCELLED:

Title: ${sessionTitle}
Date & Time: ${formattedDate}

You do not need to attend this session.

Best Regards,
Student Training Portal
    `;
        if (!transporter) {
            console.log(`\n📧 MOCK CANCELLATION EMAIL DISPATCHED to ${emails.length} recipients`);
            console.log(`Subject: ${subject}`);
            console.log(`Body: \n${text}\n`);
            return;
        }
        try {
            await transporter.sendMail({
                from: `"Student Training Portal" <${process.env.SMTP_USER}>`,
                to: emails.join(', '),
                subject,
                text,
            });
            console.log('✅ Session cancellation emails sent successfully.');
        }
        catch (error) {
            console.error('❌ Failed to send session cancellation emails:', error);
        }
    }
}
exports.EmailService = EmailService;
