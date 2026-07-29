import { google } from 'googleapis';
import { logUnaffected, RULE, type EmailMessage, type SendResult } from './types';

/**
 * Gmail REST transport (HTTPS/443).
 *
 * This exists because some hosts — Render's free instances among them — block
 * outbound SMTP ports (25/465/587) at the firewall. The Gmail API carries the
 * same message over port 443, which is never blocked.
 *
 * It reuses the existing Google OAuth *client* (GOOGLE_CLIENT_ID / SECRET) but
 * a SEPARATE refresh token (GMAIL_REFRESH_TOKEN), because a refresh token is
 * bound to the scopes it was granted. Keeping it separate means the Calendar /
 * Meet token (GOOGLE_REFRESH_TOKEN) is never touched or re-scoped.
 */
export class GmailApiMailer {
  /** Least privilege: send only. No read, no modify, no delete. */
  static readonly SCOPE = 'https://www.googleapis.com/auth/gmail.send';

  static isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN
    );
  }

  static senderAddress(): string {
    return process.env.GMAIL_SENDER || process.env.SMTP_USER || '';
  }

  private static client() {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth });
  }

  /** RFC 2047 encoding, so non-ASCII session titles survive the Subject header. */
  private static encodeHeader(value: string): string {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(value)) return value;
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  /** Builds an RFC 5322 message and base64url-encodes it for the API. */
  private static buildRaw(message: EmailMessage, from: string): string {
    const headers = [
      `From: "Student Training Portal" <${from}>`,
      `To: ${message.to.join(', ')}`,
      `Subject: ${this.encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
    ];
    const raw = `${headers.join('\r\n')}\r\n\r\n${message.text.replace(/\n/g, '\r\n')}`;
    return Buffer.from(raw, 'utf8').toString('base64url');
  }

  /**
   * Classifies a Google API error.
   *
   * Two different error shapes arrive here: the OAuth token endpoint returns
   * `{ error: 'invalid_grant', error_description: 'Bad Request' }` with HTTP
   * 400, while the Gmail API returns `{ error: { code, message, status } }`.
   * Both are flattened so the message text is actually diagnostic.
   */
  private static explain(error: any): { reason: string; action: string; detail: string } {
    const data = error?.response?.data;
    const oauthError = typeof data?.error === 'string' ? data.error : undefined;
    const apiError = data?.error && typeof data.error === 'object' ? data.error : undefined;
    const status: number | undefined = error?.response?.status ?? apiError?.code ?? error?.code;

    const detail = [
      status ? `status=${status}` : null,
      oauthError ? `error=${oauthError}` : null,
      data?.error_description ? `description=${data.error_description}` : null,
      apiError?.message ? `message="${apiError.message}"` : null,
      !oauthError && !apiError && error?.message ? `message="${error.message}"` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const haystack = `${oauthError || ''} ${data?.error_description || ''} ${apiError?.message || ''} ${error?.message || ''}`;

    if (/invalid_grant/i.test(haystack)) {
      return {
        reason: 'Google rejected the refresh token (invalid_grant).',
        action:
          'GMAIL_REFRESH_TOKEN is invalid, expired, revoked, or was issued for a different OAuth ' +
          'client. Regenerate it with `npm run gmail:auth`.',
        detail,
      };
    }
    if (/invalid_client/i.test(haystack)) {
      return {
        reason: 'Google rejected the OAuth client (invalid_client).',
        action: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET do not match the client that issued the token.',
        detail,
      };
    }
    if (status === 401) {
      return {
        reason: 'Google rejected the credentials (401 Unauthorized).',
        action: 'Regenerate GMAIL_REFRESH_TOKEN with `npm run gmail:auth`.',
        detail,
      };
    }
    if (status === 403 && /insufficient|scope|permission/i.test(haystack)) {
      return {
        reason: 'The token is valid but lacks the gmail.send scope (403).',
        action: 'Regenerate GMAIL_REFRESH_TOKEN with `npm run gmail:auth` and approve the send permission.',
        detail,
      };
    }
    if (status === 403 && /not been used|disabled/i.test(haystack)) {
      return {
        reason: 'The Gmail API is not enabled for this Google Cloud project (403).',
        action: 'Enable the Gmail API in Google Cloud Console for this OAuth client, then retry.',
        detail,
      };
    }
    if (status === 403) {
      return { reason: 'Google refused the request (403).', action: 'See the raw detail below.', detail };
    }
    if (status === 429 || /quota|rate limit/i.test(haystack)) {
      return {
        reason: 'Gmail send quota exceeded (429).',
        action: 'Gmail allows roughly 500 recipients/day on a consumer account. Wait and retry.',
        detail,
      };
    }
    if (status && status >= 500) {
      return {
        reason: `Google returned a server error (${status}).`,
        action: 'Transient on Google\'s side. The next notification will try again.',
        detail,
      };
    }
    return {
      reason: 'The Gmail API call failed for an unclassified reason.',
      action: 'Inspect the raw detail below.',
      detail,
    };
  }

  /** Verifies credentials without sending. Used by startup diagnostics. */
  static async verify(): Promise<{ ok: boolean; durationMs: number; address?: string; error?: any }> {
    const started = Date.now();
    try {
      const profile = await this.client().users.getProfile({ userId: 'me' });
      return {
        ok: true,
        durationMs: Date.now() - started,
        address: profile.data.emailAddress || undefined,
      };
    } catch (error) {
      return { ok: false, durationMs: Date.now() - started, error };
    }
  }

  /**
   * Sends one message over HTTPS. Never throws, never retries.
   * `note` explains in the log why this transport was chosen.
   */
  static async send(message: EmailMessage, note?: string): Promise<SendResult> {
    console.log(`\n${RULE}`);
    console.log(`📧 Sending ${message.label} via Gmail API (HTTPS/443)`);
    console.log(`Recipients         : ${message.to.length}`);
    console.log(`Subject            : ${message.subject}`);
    if (note) console.log(`Transport reason   : ${note}`);

    if (!this.isConfigured()) {
      console.log(`${RULE}`);
      console.warn('⚠️ Email notification could not be delivered.');
      console.warn('   Reason             : Gmail API is not configured (GMAIL_REFRESH_TOKEN missing).');
      console.warn('   What to check      : Run `npm run gmail:auth` and set GMAIL_REFRESH_TOKEN.');
      logUnaffected(message);
      return { delivered: false, kind: 'UNKNOWN_ERROR' };
    }

    const from = this.senderAddress();
    if (!from) {
      console.log(`${RULE}`);
      console.warn('⚠️ Email notification could not be delivered.');
      console.warn('   Reason             : No sender address (set GMAIL_SENDER or SMTP_USER).');
      logUnaffected(message);
      return { delivered: false, kind: 'UNKNOWN_ERROR' };
    }

    console.log(`Sender             : ${from}`);
    console.log('Requesting access token and sending...');
    console.log(`${RULE}`);

    const started = Date.now();
    try {
      const response = await this.client().users.messages.send({
        userId: 'me',
        requestBody: { raw: this.buildRaw(message, from) },
      });

      console.log('✅ Access token obtained');
      console.log('✅ Email sent successfully via Gmail API');
      console.log(`   MessageId : ${response.data.id}`);
      console.log(`   ThreadId  : ${response.data.threadId}`);
      console.log(`   Recipients: ${message.to.length}`);
      console.log(`   Time      : ${Date.now() - started} ms`);
      return { delivered: true };
    } catch (error: any) {
      const { reason, action, detail } = this.explain(error);
      console.warn('⚠️ Email notification could not be delivered.');
      console.warn('   Transport          : Gmail API (HTTPS/443)');
      console.warn(`   Reason             : ${reason}`);
      console.warn(`   What to check      : ${action}`);
      console.warn(`   Elapsed            : ${Date.now() - started} ms`);
      console.warn(`   Raw                : ${detail}`);
      logUnaffected(message);
      return { delivered: false, kind: 'UNKNOWN_ERROR' };
    }
  }

  /** Startup banner. Never prints the refresh token. */
  static async runStartupDiagnostics(): Promise<void> {
    console.log(`\n${RULE}`);
    console.log('📧 Gmail API Configuration (HTTPS/443 fallback)');

    if (!this.isConfigured()) {
      const missing = [
        !process.env.GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
        !process.env.GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
        !process.env.GMAIL_REFRESH_TOKEN && 'GMAIL_REFRESH_TOKEN',
      ].filter(Boolean);
      console.warn(`Status             : DISABLED — missing ${missing.join(', ')}`);
      console.warn('                     Run `npm run gmail:auth` to enable HTTPS email delivery.');
      console.log(`${RULE}\n`);
      return;
    }

    console.log(`Scope              : ${this.SCOPE}`);
    console.log(`Sender             : ${this.senderAddress()}`);
    console.log(`Refresh token      : ******** (${process.env.GMAIL_REFRESH_TOKEN!.length} chars, never printed)`);

    const verification = await this.verify();
    if (verification.ok) {
      console.log(`Gmail API Verify   : ✅ Reachable — authenticated as ${verification.address} (${verification.durationMs}ms)`);
    } else {
      const { reason, action, detail } = this.explain(verification.error);
      console.error(`Gmail API Verify   : ❌ Not Reachable (${verification.durationMs}ms)`);
      console.error(`   Reason          : ${reason}`);
      console.error(`   What to check   : ${action}`);
      console.error(`   Raw             : ${detail}`);
    }
    console.log(`${RULE}\n`);
  }
}
