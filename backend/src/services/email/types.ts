import type { SmtpFailureKind } from './smtpDiagnostics';

/** One outgoing notification, transport-agnostic. */
export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  /**
   * Optional HTML alternative. When present the message is sent as
   * multipart/alternative and `text` becomes the plaintext fallback, so clients
   * that cannot render HTML still receive a complete, readable message.
   */
  html?: string;
  /** Human label for the log header, e.g. "session notification". */
  label: string;
  /** The business operation this email accompanies, e.g. "session creation". */
  operation: string;
  /** Work that already completed successfully, listed if the email fails. */
  unaffected: string[];
  /**
   * Send one message per recipient instead of one message addressed to all of
   * them. Required for anything containing a credential or personal data —
   * a shared `To:` header would disclose every recipient's address to the rest.
   */
  perRecipient?: boolean;
}

export interface SendResult {
  delivered: boolean;
  /** Why it failed, when it failed. */
  kind?: SmtpFailureKind;
  /**
   * Short human-readable failure summary, safe to persist and show to an admin.
   * Never contains credentials — the mailers only ever surface classification
   * text and provider error messages, never message bodies.
   */
  reason?: string;
}

/** Failures caused by the network rather than by configuration or content. */
export function isNetworkFailure(kind?: SmtpFailureKind): boolean {
  return kind === 'CONNECTION_TIMEOUT' || kind === 'NETWORK_UNREACHABLE';
}

export const RULE = '──────────────────────────────────────────────';

/** Shared "the business transaction still succeeded" footer. */
export function logUnaffected(message: EmailMessage): void {
  console.warn(`   This does NOT affect ${message.operation}.`);
  message.unaffected.forEach((line) => console.warn(`   ✅ ${line}`));
  console.warn('   ✅ The request completed normally.');
  console.warn('   ℹ️ Email notification skipped.');
  console.warn(`${RULE}\n`);
}
