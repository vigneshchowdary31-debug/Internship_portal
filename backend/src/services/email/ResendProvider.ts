import { Resend } from 'resend';
import { EmailProvider } from './EmailProvider';

export class ResendProvider implements EmailProvider {
  private resend: Resend | null = null;
  private fromEmail: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    if (!apiKey) {
      console.warn('⚠️ RESEND_API_KEY not provided. Real emails will NOT be sent via Resend.');
      return;
    }

    this.resend = new Resend(apiKey);
    console.log('✅ Resend configured successfully.');
  }

  async sendEmail(options: { to: string[]; subject: string; text: string }): Promise<void> {
    if (!this.resend) {
      console.warn('⚠️ Cannot send email: Resend API Key is missing.');
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: `Student Training Portal <${this.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
    });

    if (error) {
      throw new Error(`Resend Error: ${error.message}`);
    }

    console.log(`✅ Session notification emails sent successfully via Resend. ID: ${data?.id}`);
  }
}
