import { EmailService } from './email.service';
import type { EmailMessage } from './email/types';

/**
 * Enrollment credential emails.
 *
 * These are the only emails in the system that carry a secret, which drives
 * three rules the session notifications do not need:
 *
 *   1. Always `perRecipient` — a shared To: header would leak the whole cohort's
 *      addresses alongside a password.
 *   2. The plaintext password is passed in, used, and dropped. It is never
 *      returned to a caller, logged, or stored anywhere but the recipient's
 *      inbox.
 *   3. Delivery is best-effort and fully isolated: `EmailService` resolves
 *      rather than rejects, so a mail failure can never roll back an enrollment
 *      that already succeeded.
 */

export interface EnrollmentRecipient {
  name: string;
  email: string;
  /** Plaintext one-time password. Lives only for the duration of this call. */
  temporaryPassword: string;
}

/** Layout primitives, kept in one place so both templates stay visually identical. */
const COLORS = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  border: '#e2e8f0',
  panel: '#f8fafc',
  accent: '#4f46e5',
  accentSoft: '#eef2ff',
} as const;

function portalUrl(): string {
  // CORS_ORIGIN is already the deployed frontend origin, so it doubles as the
  // portal URL without introducing another variable that can drift out of sync.
  // PORTAL_URL overrides it when the two genuinely differ.
  const raw = process.env.PORTAL_URL || process.env.CORS_ORIGIN || '';
  if (!raw || raw === '*') return 'your Student Training Portal URL';
  return raw.replace(/\/+$/, '');
}

/**
 * Minimal HTML escaping for interpolated values.
 *
 * Names and university names are admin- or CSV-supplied, so they are untrusted
 * input arriving in an HTML document. Escaping here keeps a name like
 * `A <b>Name</b>` from altering the email's markup.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detailRow(label: string, value: string, mono = false): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:13px;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td style="padding:10px 0 10px 16px;border-bottom:1px solid ${COLORS.border};color:${COLORS.ink};font-size:14px;font-weight:600;${
        mono ? `font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;letter-spacing:0.4px;` : ''
      }word-break:break-all;">${esc(value)}</td>
    </tr>`;
}

/**
 * Responsive HTML shell.
 *
 * Table-based with inline styles throughout — email clients (Outlook in
 * particular) do not reliably support flexbox, grid, or <style> blocks. The
 * single media query collapses horizontal padding on narrow screens; everything
 * else is fluid by construction via max-width.
 */
function shell(heading: string, intro: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(heading)}</title>
<style>
  @media only screen and (max-width:600px){
    .sp{padding-left:20px!important;padding-right:20px!important}
    .h1{font-size:22px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.panel};-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.panel};">
<tr><td align="center" style="padding:32px 12px;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:600px;background:#ffffff;border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    <tr><td style="height:4px;background:${COLORS.accent};font-size:0;line-height:0;">&nbsp;</td></tr>

    <tr><td class="sp" style="padding:36px 40px 8px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${COLORS.accent};">Student Training Portal</p>
      <h1 class="h1" style="margin:0;font-size:26px;line-height:1.25;color:${COLORS.ink};font-weight:700;">${esc(heading)}</h1>
    </td></tr>

    <tr><td class="sp" style="padding:16px 40px 0;">
      <p style="margin:0;font-size:15px;line-height:1.65;color:${COLORS.body};">${intro}</p>
    </td></tr>

    ${body}

    <tr><td class="sp" style="padding:24px 40px 36px;border-top:1px solid ${COLORS.border};">
      <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
        This is an automated message from the Student Training Portal.
        If you were not expecting it, please contact your administrator.
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

function credentialsBlock(email: string, password: string, instructions: string[]): string {
  return `
    <tr><td class="sp" style="padding:24px 40px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:${COLORS.accentSoft};border:1px solid #c7d2fe;border-radius:10px;">
        <tr><td style="padding:20px 22px;">
          <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${COLORS.accent};">Your login credentials</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${detailRow('Portal URL', portalUrl())}
            ${detailRow('Email', email)}
            ${detailRow('Temporary Password', password, true)}
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td class="sp" style="padding:28px 40px 0;">
      <a href="${esc(portalUrl())}"
         style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 30px;border-radius:8px;">
        Log in to the portal
      </a>
    </td></tr>

    <tr><td class="sp" style="padding:28px 40px 0;">
      <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${COLORS.ink};">Next steps</p>
      <ol style="margin:0;padding-left:20px;color:${COLORS.body};font-size:14px;line-height:1.75;">
        ${instructions.map((line) => `<li style="margin-bottom:4px;">${line}</li>`).join('\n        ')}
      </ol>
    </td></tr>

    <tr><td class="sp" style="padding:24px 40px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#92400e;">
            <strong>Keep this password private.</strong> You will be asked to replace it the first time you sign in.
            Portal staff will never ask you for it.
          </p>
        </td></tr>
      </table>
    </td></tr>`;
}

export class EnrollmentEmailService {
  private static readonly SUBJECT = 'Welcome to Internship Training Portal';

  private static studentMessage(recipient: EnrollmentRecipient): EmailMessage {
    const instructions = [
      'Log in using the credentials above.',
      '<strong>Change your password immediately</strong> — you will be prompted automatically on first login.',
      'Never share your credentials with anyone.',
      'Contact your administrator if you face any issues.',
    ];

    const text = `Hello ${recipient.name},

Congratulations! You have been enrolled for Internship Training.

Portal URL        : ${portalUrl()}
Email             : ${recipient.email}
Temporary Password: ${recipient.temporaryPassword}

Instructions:
  1. Log in using the credentials above.
  2. Change your password immediately - you will be prompted on first login.
  3. Never share your credentials with anyone.
  4. Contact your administrator if you face any issues.

Best Regards,
Student Training Portal`;

    return {
      to: [recipient.email],
      subject: this.SUBJECT,
      text,
      html: shell(
        'Welcome aboard',
        `Hello <strong>${esc(recipient.name)}</strong>, congratulations — you have been enrolled for Internship Training.`,
        credentialsBlock(recipient.email, recipient.temporaryPassword, instructions)
      ),
      label: 'student enrollment email',
      operation: 'the student enrollment',
      unaffected: [
        'The student account has already been created successfully.',
        'The student can be given their credentials manually if needed.',
      ],
      perRecipient: true,
    };
  }

  private static instructorMessage(recipient: EnrollmentRecipient): EmailMessage {
    const instructions = [
      'Log in using the credentials above.',
      '<strong>Change your password</strong> — you will be prompted automatically on first login.',
      'Do not share your credentials with anyone.',
      'Contact your administrator if you face any issues.',
    ];

    const text = `Hello ${recipient.name},

Your instructor account has been created.

Portal URL        : ${portalUrl()}
Email             : ${recipient.email}
Temporary Password: ${recipient.temporaryPassword}

Instructions:
  1. Log in using the credentials above.
  2. Change your password - you will be prompted on first login.
  3. Do not share your credentials with anyone.
  4. Contact your administrator if you face any issues.

Best Regards,
Student Training Portal`;

    return {
      to: [recipient.email],
      subject: this.SUBJECT,
      text,
      html: shell(
        'Your instructor account is ready',
        `Hello <strong>${esc(recipient.name)}</strong>, your instructor account has been created.`,
        credentialsBlock(recipient.email, recipient.temporaryPassword, instructions)
      ),
      label: 'instructor enrollment email',
      operation: 'the instructor enrollment',
      unaffected: [
        'The instructor account has already been created successfully.',
        'The instructor can be given their credentials manually if needed.',
      ],
      perRecipient: true,
    };
  }

  /**
   * Sends the enrollment email for a newly created account.
   *
   * Never throws. The returned outcome is recorded against the user's
   * credential-delivery fields and audit trail — enrollment itself must never
   * depend on it.
   */
  static async sendEnrollmentEmail(
    role: 'STUDENT' | 'INSTRUCTOR',
    recipient: EnrollmentRecipient
  ): Promise<{ delivered: boolean; reason?: string }> {
    try {
      const message =
        role === 'INSTRUCTOR' ? this.instructorMessage(recipient) : this.studentMessage(recipient);
      const result = await EmailService.send(message);
      return {
        delivered: result.delivered,
        reason: result.delivered ? undefined : result.reason || 'Delivery failed for an unknown reason',
      };
    } catch (error: any) {
      // Defensive: EmailService already swallows its own failures.
      console.error('[email] Unexpected enrollment email failure:', error?.message || error);
      return { delivered: false, reason: error?.message || 'Unexpected error while sending' };
    }
  }
}
