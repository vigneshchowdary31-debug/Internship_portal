import dns from 'dns';
import net from 'net';

/**
 * Diagnostics helpers for the SMTP transport.
 *
 * The point of this module is to make an SMTP failure self-explaining in the
 * logs: which layer failed (DNS, TCP, TLS, AUTH, SMTP) and what to do about it.
 */

export type SmtpFailureKind =
  | 'DNS_FAILURE'
  | 'AUTH_FAILURE'
  | 'TLS_FAILURE'
  | 'CONNECTION_TIMEOUT'
  | 'NETWORK_UNREACHABLE'
  | 'SMTP_REJECTED'
  | 'UNKNOWN_ERROR';

export interface ClassifiedSmtpError {
  kind: SmtpFailureKind;
  /** One-line explanation of what actually happened. */
  reason: string;
  /** What to check or change. */
  action: string;
  /** Raw error fields, for when the summary is not enough. */
  detail: string;
}

export interface DnsResolution {
  host: string;
  addresses: { address: string; family: number }[];
  durationMs: number;
  error?: string;
}

export type TcpProbeOutcome = 'connected' | 'timeout' | 'refused' | 'unreachable' | 'error';

export interface TcpProbeResult {
  host: string;
  port: number;
  outcome: TcpProbeOutcome;
  durationMs: number;
  error?: string;
}

/** Resolve a hostname and report every address plus how long resolution took. */
export async function resolveHost(host: string, family: 0 | 4 | 6 = 4): Promise<DnsResolution> {
  const started = Date.now();
  try {
    const addresses = await dns.promises.lookup(host, { all: true, family });
    return {
      host,
      addresses: addresses.map((a) => ({ address: a.address, family: a.family })),
      durationMs: Date.now() - started,
    };
  } catch (error: any) {
    return {
      host,
      addresses: [],
      durationMs: Date.now() - started,
      error: `${error.code || error.name || 'ERR'}: ${error.message}`,
    };
  }
}

/**
 * Raw TCP reachability probe, deliberately bypassing nodemailer so a failure can
 * be attributed to the network rather than to SMTP.
 *
 * A silently dropped SYN (firewall blackhole) surfaces as `timeout`.
 * A host that actively rejects surfaces as `refused`.
 */
export function probeTcpPort(
  host: string,
  port: number,
  timeoutMs = 8000,
  family: 0 | 4 | 6 = 4
): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;

    const socket = new net.Socket();
    const finish = (outcome: TcpProbeOutcome, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, outcome, durationMs: Date.now() - started, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('connected'));
    socket.once('timeout', () => finish('timeout', `no TCP handshake within ${timeoutMs}ms`));
    socket.once('error', (error: any) => {
      const code = error.code || '';
      if (code === 'ECONNREFUSED') return finish('refused', code);
      if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return finish('unreachable', code);
      if (code === 'ETIMEDOUT') return finish('timeout', code);
      finish('error', `${code || 'ERR'}: ${error.message}`);
    });

    socket.connect({ host, port, family: family === 0 ? undefined : family } as net.NetConnectOpts);
  });
}

/**
 * Turns a nodemailer/Node error into an actionable classification.
 *
 * Nodemailer surfaces `code` (ETIMEDOUT, ESOCKET, EAUTH, EENVELOPE, ...),
 * `command` (CONN, EHLO, AUTH, ...) and `responseCode` for SMTP replies. Socket
 * errors are wrapped as ESOCKET, so the real syscall code frequently appears
 * only inside the message text — hence the string checks below.
 */
export function classifySmtpError(error: any, host: string, port: number): ClassifiedSmtpError {
  const code: string = error?.code || '';
  const command: string = error?.command || '';
  const responseCode: number | undefined = error?.responseCode;
  const message: string = error?.message || String(error);
  const lower = message.toLowerCase();

  const detail = [
    `code=${code || 'n/a'}`,
    `command=${command || 'n/a'}`,
    responseCode ? `responseCode=${responseCode}` : null,
    `message="${message.replace(/\s+/g, ' ').trim()}"`,
  ]
    .filter(Boolean)
    .join(' ');

  if (code === 'EDNS' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || lower.includes('getaddrinfo')) {
    return {
      kind: 'DNS_FAILURE',
      reason: `The hostname ${host} could not be resolved to an IP address.`,
      action: 'Check SMTP_HOST for typos, and that this environment has DNS egress.',
      detail,
    };
  }

  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 || lower.includes('invalid login')) {
    return {
      kind: 'AUTH_FAILURE',
      reason: 'The SMTP server was reached, but it rejected the credentials.',
      action:
        'Check SMTP_USER / SMTP_PASS. For Gmail this must be a 16-character App Password ' +
        '(not the account password), with no wrapping quotes or trailing whitespace.',
      detail,
    };
  }

  if (
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    lower.includes('enetunreach') ||
    lower.includes('ehostunreach')
  ) {
    return {
      kind: 'NETWORK_UNREACHABLE',
      reason: `There is no usable network route to ${host}:${port}.`,
      action:
        'Usually an IPv6 address on a host without IPv6 egress. SMTP_IP_FAMILY=4 (the default) pins IPv4.',
      detail,
    };
  }

  if (code === 'ECONNREFUSED') {
    return {
      kind: 'NETWORK_UNREACHABLE',
      reason: `${host}:${port} actively refused the TCP connection.`,
      action: 'Check SMTP_PORT — a refused connection means nothing is listening on that port.',
      detail,
    };
  }

  if (lower.includes('greeting never received')) {
    return {
      kind: 'CONNECTION_TIMEOUT',
      reason: `TCP connected to ${host}:${port}, but the server never sent its 220 greeting.`,
      action: 'A proxy or middlebox is likely intercepting the SMTP port. Try SMTP_GREETING_TIMEOUT higher, or port 465.',
      detail,
    };
  }

  if (code === 'ETIMEDOUT' || lower.includes('timeout')) {
    return {
      kind: 'CONNECTION_TIMEOUT',
      reason:
        `The SMTP server could not be reached — the connection to ${host}:${port} was never ` +
        'established and the packets were silently dropped.',
      action:
        `Outbound traffic to port ${port} is blocked by the host platform or network firewall. ` +
        'Render free instances block outbound 25/465/587; port 25 is blocked on every Render plan. ' +
        'A blocked port always times out — it never returns ECONNREFUSED.',
      detail,
    };
  }

  if (
    code === 'ESOCKET' ||
    code === 'ETLS' ||
    lower.includes('ssl') ||
    lower.includes('tls') ||
    lower.includes('wrong version number') ||
    lower.includes('certificate')
  ) {
    return {
      kind: 'TLS_FAILURE',
      reason: `The TLS handshake with ${host}:${port} failed.`,
      action:
        `Check the port/TLS mode pairing: port 465 needs secure=true (implicit TLS), ` +
        `port 587 needs secure=false (STARTTLS). Current port is ${port}.`,
      detail,
    };
  }

  if (code === 'EENVELOPE' || (responseCode && responseCode >= 500)) {
    return {
      kind: 'SMTP_REJECTED',
      reason: 'The server accepted the connection but rejected the message or its recipients.',
      action: 'Check the recipient addresses and that the From address is allowed for this account.',
      detail,
    };
  }

  return {
    kind: 'UNKNOWN_ERROR',
    reason: 'The send failed for a reason that could not be classified.',
    action: 'Inspect the raw error below; enable SMTP_DEBUG=true to log the full handshake.',
    detail,
  };
}
