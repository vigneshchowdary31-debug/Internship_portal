import type { SmtpFailureKind } from './smtpDiagnostics';

/** One outgoing notification, transport-agnostic. */
export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  /** Human label for the log header, e.g. "session notification". */
  label: string;
  /** The business operation this email accompanies, e.g. "session creation". */
  operation: string;
  /** Work that already completed successfully, listed if the email fails. */
  unaffected: string[];
}

export interface SendResult {
  delivered: boolean;
  /** Why it failed, when it failed. */
  kind?: SmtpFailureKind;
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
