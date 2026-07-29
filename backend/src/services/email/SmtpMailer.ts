import nodemailer from 'nodemailer';
import { classifySmtpError, probeTcpPort, resolveHost } from './smtpDiagnostics';

export interface SmtpMessage {
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

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  family: 0 | 4 | 6;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  debug: boolean;
}

const RULE = '──────────────────────────────────────────────';

function int(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readConfig(): SmtpConfig | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = int(process.env.SMTP_PORT, 587);
  // Explicit override wins; otherwise 465 = implicit TLS, everything else = STARTTLS.
  const secure =
    process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : port === 465;
  const familyRaw = int(process.env.SMTP_IP_FAMILY, 4);

  return {
    host,
    port,
    secure,
    user,
    pass,
    family: familyRaw === 6 ? 6 : familyRaw === 0 ? 0 : 4,
    connectionTimeout: int(process.env.SMTP_CONNECTION_TIMEOUT, 15000),
    greetingTimeout: int(process.env.SMTP_GREETING_TIMEOUT, 10000),
    socketTimeout: int(process.env.SMTP_SOCKET_TIMEOUT, 25000),
    debug: process.env.SMTP_DEBUG === 'true',
  };
}

/**
 * Bunyan-shaped logger that nodemailer accepts. Exposes the real handshake
 * stages (connect, EHLO, STARTTLS, AUTH, DATA). Enabled with SMTP_DEBUG=true;
 * nodemailer masks AUTH payloads, so credentials are never logged.
 */
function handshakeLogger() {
  const emit = (level: string) => (...args: any[]) => {
    const message = args.find((arg) => typeof arg === 'string');
    if (message) console.log(`   · ${level} ${message}`);
  };
  return {
    level: () => {},
    trace: emit('trace'),
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
  };
}

/**
 * The one and only email transport. No provider abstraction, no fallback
 * vendor, no retry loop: one connection attempt per message, one log line set,
 * then return. Never throws.
 */
export class SmtpMailer {
  private static config: SmtpConfig | null = null;

  static getConfig(): SmtpConfig | null {
    if (!this.config) this.config = readConfig();
    return this.config;
  }

  /**
   * Builds a one-shot transport aimed at a specific address.
   *
   * nodemailer 9 ignores the `family` option entirely — it resolves the host
   * itself and then picks a *random* entry from the combined IPv4+IPv6 list. On
   * hosts that advertise IPv6 without usable IPv6 egress that fails
   * intermittently, so the address is resolved here and pinned. `servername`
   * keeps SNI and certificate validation bound to the real hostname.
   */
  private static createTransport(config: SmtpConfig, address: string): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: address,
      port: config.port,
      secure: config.secure,
      // Port 587 must upgrade via STARTTLS; never fall back to cleartext.
      requireTLS: !config.secure,
      servername: config.host,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: config.connectionTimeout,
      greetingTimeout: config.greetingTimeout,
      socketTimeout: config.socketTimeout,
      pool: false,
      tls: { minVersion: 'TLSv1.2', servername: config.host },
      logger: config.debug ? (handshakeLogger() as any) : false,
      debug: config.debug,
    } as nodemailer.TransportOptions);
  }

  /**
   * The address to connect to. With SMTP_IP_FAMILY=0 the hostname is used and
   * nodemailer does its own resolution.
   */
  private static async resolveTarget(
    config: SmtpConfig
  ): Promise<{ address?: string; error?: string; durationMs: number }> {
    if (config.family === 0) return { address: config.host, durationMs: 0 };

    const dnsResult = await resolveHost(config.host, config.family);
    if (dnsResult.error) return { error: dnsResult.error, durationMs: dnsResult.durationMs };
    if (dnsResult.addresses.length === 0) {
      return { error: `no IPv${config.family} address for ${config.host}`, durationMs: dnsResult.durationMs };
    }
    return { address: dnsResult.addresses[0].address, durationMs: dnsResult.durationMs };
  }

  /**
   * Sends one message. Returns true on delivery, false on any failure.
   * Never throws and never retries.
   */
  static async send(message: SmtpMessage): Promise<boolean> {
    const config = this.getConfig();

    console.log(`\n${RULE}`);
    console.log(`📧 Sending ${message.label}`);
    console.log(`Recipients         : ${message.to.length}`);
    console.log(`Subject            : ${message.subject}`);

    if (!config) {
      console.log(`${RULE}`);
      console.warn('⚠️ Email notification could not be delivered.');
      console.warn('   Reason             : SMTP is not configured (SMTP_USER / SMTP_PASS missing).');
      this.logUnaffected(message);
      return false;
    }

    console.log(`SMTP Host          : ${config.host}`);
    console.log(`SMTP Port          : ${config.port} (${config.secure ? 'implicit TLS' : 'STARTTLS'})`);
    console.log(`Connection Timeout : ${config.connectionTimeout}ms`);
    console.log('Attempting SMTP connection...');
    console.log(`${RULE}`);

    const started = Date.now();
    const target = await this.resolveTarget(config);

    if (!target.address) {
      const classified = classifySmtpError({ code: 'EDNS', message: target.error }, config.host, config.port);
      this.logFailure(classified, Date.now() - started, message);
      return false;
    }

    try {
      const info = await this.createTransport(config, target.address).sendMail({
        from: `"Student Training Portal" <${config.user}>`,
        to: message.to.join(', '),
        subject: message.subject,
        text: message.text,
      });

      // Reaching this point means the socket connected, TLS was negotiated and
      // AUTH succeeded — nodemailer will not send DATA otherwise.
      console.log(`✅ SMTP Connected      (${target.address}:${config.port})`);
      console.log('✅ Authenticated');
      console.log('✅ Email sent successfully');
      console.log(`   MessageId : ${info.messageId}`);
      console.log(`   Accepted  : ${(info.accepted || []).length}/${message.to.length}`);
      console.log(`   Time      : ${Date.now() - started} ms`);
      if (info.rejected && info.rejected.length > 0) {
        console.warn(`   ⚠️ Rejected : ${info.rejected.join(', ')}`);
      }
      return true;
    } catch (error: any) {
      this.logFailure(classifySmtpError(error, config.host, config.port), Date.now() - started, message);
      return false;
    }
  }

  /** Single failure log. No retry, no escalation — log once and return. */
  private static logFailure(
    classified: ReturnType<typeof classifySmtpError>,
    elapsedMs: number,
    message: SmtpMessage
  ): void {
    console.warn('⚠️ Email notification could not be delivered.');
    console.warn(`   Classification     : ${classified.kind}`);
    console.warn(`   Reason             : ${classified.reason}`);
    console.warn(`   What to check      : ${classified.action}`);
    console.warn(`   Elapsed            : ${elapsedMs} ms`);
    console.warn(`   Raw                : ${classified.detail}`);
    this.logUnaffected(message);
  }

  /** Makes explicit, in the log, that the business transaction already succeeded. */
  private static logUnaffected(message: SmtpMessage): void {
    console.warn(`   This does NOT affect ${message.operation}.`);
    message.unaffected.forEach((line) => console.warn(`   ✅ ${line}`));
    console.warn('   ✅ The request completed normally.');
    console.warn('   ℹ️ Email notification skipped.');
    console.warn(`${RULE}\n`);
  }

  /**
   * Startup configuration banner and reachability check.
   * The password is never printed — only its length.
   */
  static async runStartupDiagnostics(): Promise<void> {
    const config = this.getConfig();

    console.log(`\n${RULE}`);
    console.log('📧 SMTP Configuration');

    if (!config) {
      console.warn('Status             : DISABLED — SMTP_USER / SMTP_PASS not set');
      console.warn('                     Emails will be skipped; nothing else is affected.');
      console.log(`${RULE}\n`);
      return;
    }

    console.log(`Host               : ${config.host}`);
    console.log(`Port               : ${config.port}`);
    console.log(`Secure             : ${config.secure} (${config.secure ? 'implicit TLS' : 'STARTTLS'})`);
    console.log(`Connection Timeout : ${config.connectionTimeout}ms`);
    console.log(`Greeting Timeout   : ${config.greetingTimeout}ms`);
    console.log(`Socket Timeout     : ${config.socketTimeout}ms`);
    console.log(`IP Family          : ${config.family === 0 ? 'auto' : `IPv${config.family} (pinned)`}`);
    console.log(`User               : ${config.user}`);
    console.log(`Password           : ******** (${config.pass.length} chars, never printed)`);

    const target = await this.resolveTarget(config);
    if (!target.address) {
      console.error(`DNS                : ❌ FAILED — ${target.error}`);
      console.error('SMTP Verify        : ❌ Not Reachable');
      console.log(`${RULE}\n`);
      return;
    }
    console.log(`DNS                : ✅ ${target.address} in ${target.durationMs}ms`);

    const started = Date.now();
    try {
      await this.createTransport(config, target.address).verify();
      console.log(
        `SMTP Verify        : ✅ Reachable — connected, TLS negotiated, authenticated (${Date.now() - started}ms)`
      );
      console.log(`${RULE}\n`);
    } catch (error: any) {
      const classified = classifySmtpError(error, config.host, config.port);
      console.error(`SMTP Verify        : ❌ Not Reachable (${Date.now() - started}ms)`);
      console.error(`   Classification  : ${classified.kind}`);
      console.error(`   Reason          : ${classified.reason}`);
      console.error(`   What to check   : ${classified.action}`);
      console.error(`   Raw             : ${classified.detail}`);

      // Runs once, at startup only, when the failure looks like a blocked port:
      // raw TCP probes show whether the boundary is the platform or the app.
      if (classified.kind === 'CONNECTION_TIMEOUT' || classified.kind === 'NETWORK_UNREACHABLE') {
        await this.probeEgress(config);
      }

      console.error('   ℹ️ Email notifications will be skipped. Session creation, Google Meet,');
      console.error('     Google Calendar and all API responses are unaffected.');
      console.log(`${RULE}\n`);
    }
  }

  /**
   * Raw TCP probes separating "this platform blocks SMTP ports" from
   * "this platform has no outbound network at all". Startup only.
   */
  private static async probeEgress(config: SmtpConfig): Promise<void> {
    const family = config.family === 0 ? 4 : config.family;
    const targets = [
      { host: config.host, port: 587, label: 'SMTP submission (STARTTLS)' },
      { host: config.host, port: 465, label: 'SMTP submission (implicit TLS)' },
      { host: 'www.google.com', port: 443, label: 'HTTPS control probe' },
    ];

    console.error('   Outbound connectivity probes:');
    const outcomes: Record<string, string> = {};
    for (const target of targets) {
      const result = await probeTcpPort(target.host, target.port, 8000, family);
      outcomes[`${target.host}:${target.port}`] = result.outcome;
      const icon = result.outcome === 'connected' ? '✅' : '❌';
      console.error(
        `     ${icon} ${target.host}:${target.port} — ${result.outcome} in ${result.durationMs}ms  [${target.label}]`
      );
    }

    const httpsOk = outcomes['www.google.com:443'] === 'connected';
    const smtpBlocked =
      outcomes[`${config.host}:587`] !== 'connected' && outcomes[`${config.host}:465`] !== 'connected';

    if (httpsOk && smtpBlocked) {
      console.error(
        '   Conclusion      : outbound networking works (HTTPS/443 connected) but every SMTP port ' +
          'times out. Outbound SMTP is blocked by the hosting platform — an infrastructure limit, ' +
          'not an application bug. Render free instances block 25/465/587; any paid instance restores 465/587.'
      );
    } else if (!httpsOk) {
      console.error(
        `   Conclusion      : even HTTPS/443 is unreachable — this environment has no usable outbound ` +
          `network on IPv${family}, or DNS/routing is broken.`
      );
    } else {
      console.error(
        '   Conclusion      : SMTP ports are reachable at the TCP level — the failure is above the ' +
          'network layer (TLS, authentication or SMTP rejection).'
      );
    }
  }
}
