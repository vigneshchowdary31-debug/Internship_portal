import { google } from 'googleapis';
import { randomBytes } from 'crypto';
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

  /**
   * The OAuth client for the Gmail transport.
   *
   * Uses GMAIL_REFRESH_TOKEN — deliberately NOT GOOGLE_REFRESH_TOKEN, which is
   * scoped to calendar.events and cannot send mail.
   */
  private static oauthClient() {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return auth;
  }

  private static client() {
    return google.gmail({ version: 'v1', auth: this.oauthClient() });
  }

  /** RFC 2047 encoding, so non-ASCII session titles survive the Subject header. */
  private static encodeHeader(value: string): string {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(value)) return value;
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  /**
   * Builds an RFC 5322 message and base64url-encodes it for the API.
   *
   * With `html` present the message becomes multipart/alternative: the
   * plaintext part first, the HTML part second. Order is mandated by RFC 2046 —
   * clients render the *last* part they understand, so text-first/HTML-second
   * gives HTML clients the rich version and everyone else a readable fallback.
   */
  private static buildRaw(message: EmailMessage, from: string): string {
    const baseHeaders = [
      `From: "Student Training Portal" <${from}>`,
      `To: ${message.to.join(', ')}`,
      `Subject: ${this.encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
    ];

    if (!message.html) {
      const headers = [
        ...baseHeaders,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
      ];
      const raw = `${headers.join('\r\n')}\r\n\r\n${message.text.replace(/\n/g, '\r\n')}`;
      return Buffer.from(raw, 'utf8').toString('base64url');
    }

    // Random boundary so it can never collide with body content.
    const boundary = `----=_Part_${randomBytes(16).toString('hex')}`;
    const headers = [
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];

    const raw = [
      headers.join('\r\n'),
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text.replace(/\n/g, '\r\n'),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.html.replace(/\n/g, '\r\n'),
      `--${boundary}--`,
      '',
    ].join('\r\n');

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
        // Deliberately does NOT claim the token lacks gmail.send. This exact
        // 403 is also what a *correct* send-only token returns for any read
        // operation (users.getProfile, users.messages.list, …), because
        // gmail.send is write-only. Asserting the cause here previously sent
        // debugging in precisely the wrong direction. The startup banner
        // resolves the ambiguity properly by reading the granted scopes from
        // the OAuth2 tokeninfo endpoint.
        reason: `Google refused the call for insufficient scopes (403) on ${
          apiError?.message?.includes('Metadata') ? 'a metadata read' : 'this operation'
        }.`,
        action:
          'Check the "Granted Scopes" list in the startup banner. If it already contains ' +
          `${this.SCOPE}, the credential is fine and the failing call is one a send-only ` +
          'token is not entitled to make. If it does not, regenerate GMAIL_REFRESH_TOKEN ' +
          'with `npm run gmail:auth`.',
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

  /**
   * True when the granted scope set actually permits sending.
   *
   * `mail.google.com/` is the legacy full-access scope and is a superset of
   * gmail.send, so a token holding it can send too.
   */
  static hasSendScope(scopes: string[] | undefined): boolean {
    if (!scopes) return false;
    return scopes.some((scope) => scope === this.SCOPE || scope === 'https://mail.google.com/');
  }

  /**
   * Verifies the credential WITHOUT sending, and without calling anything the
   * token is not entitled to.
   *
   * Previously this called `users.getProfile`, which was the bug this whole
   * transport was failing on. `getProfile` requires a *read* scope
   * (gmail.readonly / gmail.metadata / gmail.modify / mail.google.com);
   * `gmail.send` is write-only and is deliberately NOT on that list. So a
   * perfectly valid send-only token always came back
   * "403 Request had insufficient authentication scopes" — and the classifier
   * then reported the exact opposite of the truth: that the token lacked
   * gmail.send.
   *
   * The correct check is the OAuth2 tokeninfo endpoint. It requires no scope at
   * all, and it returns the authoritative list of scopes Google actually
   * granted — which is the only thing worth verifying here.
   */
  static async verify(): Promise<{
    ok: boolean;
    durationMs: number;
    /** Scopes Google reports for this refresh token. */
    scopes?: string[];
    /** OAuth client the token was issued to — catches cross-client mix-ups. */
    audience?: string;
    accessTokenObtained: boolean;
    accessTokenExpiry?: string;
    error?: any;
    /** Set when the token is valid but not entitled to send. */
    scopeError?: string;
  }> {
    const started = Date.now();

    let accessToken: string | undefined;
    try {
      const auth = this.oauthClient();
      const response = await auth.getAccessToken();
      accessToken = response.token || undefined;

      if (!accessToken) {
        return {
          ok: false,
          durationMs: Date.now() - started,
          accessTokenObtained: false,
          error: new Error('Google returned no access token for this refresh token'),
        };
      }

      const info = await auth.getTokenInfo(accessToken);
      const scopes = info.scopes || [];
      const ok = this.hasSendScope(scopes);

      return {
        ok,
        durationMs: Date.now() - started,
        scopes,
        audience: info.aud,
        accessTokenObtained: true,
        accessTokenExpiry: info.expiry_date ? new Date(info.expiry_date).toISOString() : undefined,
        scopeError: ok
          ? undefined
          : `The token was granted [${scopes.join(', ') || 'no scopes'}] but not ${this.SCOPE}.`,
      };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        accessTokenObtained: Boolean(accessToken),
        error,
      };
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
      return {
        delivered: false,
        kind: 'UNKNOWN_ERROR',
        reason: 'Gmail API is not configured (GMAIL_REFRESH_TOKEN missing)',
      };
    }

    const from = this.senderAddress();
    if (!from) {
      console.log(`${RULE}`);
      console.warn('⚠️ Email notification could not be delivered.');
      console.warn('   Reason             : No sender address (set GMAIL_SENDER or SMTP_USER).');
      logUnaffected(message);
      return {
        delivered: false,
        kind: 'UNKNOWN_ERROR',
        reason: 'No sender address configured (GMAIL_SENDER / SMTP_USER)',
      };
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
      return { delivered: false, kind: 'UNKNOWN_ERROR', reason };
    }
  }

  /** Shows enough of an identifier to compare two values, never enough to use one. */
  private static mask(value?: string): string {
    if (!value) return '(unset)';
    if (value.length <= 14) return `${value.slice(0, 4)}…(${value.length} chars)`;
    return `${value.slice(0, 8)}…${value.slice(-4)} (${value.length} chars)`;
  }

  /**
   * Startup banner.
   *
   * Prints the full OAuth picture — which client, which token, what Google
   * actually granted — because the failure mode this replaced was one where
   * every individual setting was correct and only the interaction between them
   * was wrong. A banner that says "not reachable" without showing the granted
   * scopes sends you looking in the wrong place.
   *
   * Never prints the refresh token or the access token.
   */
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

    console.log(`OAuth Client ID    : ${this.mask(process.env.GOOGLE_CLIENT_ID)}`);
    console.log(`Redirect URI       : ${process.env.GOOGLE_REDIRECT_URI || '(unset)'}`);
    console.log('Refresh Token Src  : GMAIL_REFRESH_TOKEN (separate from GOOGLE_REFRESH_TOKEN)');
    console.log(`Refresh Token      : ${this.mask(process.env.GMAIL_REFRESH_TOKEN)} — value never printed`);
    console.log(`Sender (From)      : ${this.senderAddress() || '(unset)'}`);
    console.log(`Required Scope     : ${this.SCOPE}`);

    const verification = await this.verify();

    console.log(
      `Access Token       : ${verification.accessTokenObtained ? '✅ obtained' : '❌ not obtained'}` +
        (verification.accessTokenExpiry ? ` (expires ${verification.accessTokenExpiry})` : '')
    );

    if (verification.audience) {
      const sameClient = verification.audience === process.env.GOOGLE_CLIENT_ID;
      console.log(
        `Token Audience     : ${this.mask(verification.audience)} ` +
          (sameClient ? '✅ matches this OAuth client' : '❌ ISSUED TO A DIFFERENT OAUTH CLIENT')
      );
    }

    if (verification.scopes) {
      console.log('Granted Scopes     :');
      if (verification.scopes.length === 0) {
        console.log('   (none returned)');
      } else {
        verification.scopes.forEach((scope) => {
          const marker = this.hasSendScope([scope]) ? '✅' : '  ';
          console.log(`   ${marker} ${scope}`);
        });
      }
    }

    if (verification.ok) {
      console.log(`Gmail API Verify   : ✅ Ready to send (${verification.durationMs}ms)`);
      console.log('   ℹ️ Verified by OAuth2 tokeninfo, not users.getProfile — a send-only');
      console.log('     token is not entitled to read the profile, so getProfile would');
      console.log('     return 403 even on a perfectly good credential.');
    } else if (verification.scopeError) {
      console.error(`Gmail API Verify   : ❌ Not authorised to send (${verification.durationMs}ms)`);
      console.error(`   Reason          : ${verification.scopeError}`);
      console.error('   What to check   : Regenerate with `npm run gmail:auth` and approve the');
      console.error('                     "Send email on your behalf" permission. Paste the new');
      console.error('                     value into GMAIL_REFRESH_TOKEN (not GOOGLE_REFRESH_TOKEN).');
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
