import nodemailer from 'nodemailer';
import { EmailProvider } from './EmailProvider';

export class GmailSMTPProvider implements EmailProvider {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);

    if (!user || !pass) {
      console.warn('⚠️ SMTP credentials not provided. Real emails will NOT be sent.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
      family: 4, // Force IPv4 to avoid ENETUNREACH with IPv6 on Render
      connectionTimeout: 10000,
      socketTimeout: 15000,
      greetingTimeout: 5000,
    } as any);

    // Verify transporter initialization
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('❌ SMTP Connection Error:', error);
      } else {
        console.log('✅ SMTP Connected successfully. Server is ready to take our messages.');
      }
    });
  }

  async sendEmail(options: { to: string[]; subject: string; text: string }): Promise<void> {
    if (!this.transporter) {
      console.warn('⚠️ Cannot send email: No valid SMTP transporter configured.');
      return;
    }

    const info = await this.transporter.sendMail({
      from: `"Student Training Portal" <${process.env.SMTP_USER}>`,
      to: options.to.join(', '),
      subject: options.subject,
      text: options.text,
    });
    console.log(`✅ Session notification emails sent successfully via SMTP. MessageId: ${info.messageId}`);
  }
}
