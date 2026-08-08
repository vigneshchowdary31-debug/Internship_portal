/**
 * Structured logging.
 *
 * Production emits one JSON object per line, which is what every log platform
 * ingests without a custom parser. Development emits something a human reads at
 * a glance. The call sites are identical either way — nothing branches on
 * environment except the formatter.
 *
 * The point of the shared context fields is correlation: given a requestId from
 * a support ticket you can find every line that request produced, including the
 * ones the email queue wrote minutes later.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  /** Correlates every line produced by one HTTP request. */
  requestId?: string;
  /** Who did it. Never an email or a name — an id, so logs carry no PII. */
  userId?: string;
  assignmentId?: string;
  submissionId?: string;
  quizId?: string;
  batchId?: string;
  /** Milliseconds, for anything worth timing. */
  durationMs?: number;
  count?: number;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Everything at or above this is emitted. Silent under test by default. */
function minLevel(): number {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel;
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  if (process.env.NODE_ENV === 'test') return LEVEL_ORDER.error + 1; // off
  return LEVEL_ORDER.info;
}

/**
 * Values that must never reach a log line, whatever a caller passes.
 *
 * Logs are shipped to third-party platforms and kept for months, so this is a
 * belt-and-braces filter rather than a claim that no call site would ever do it.
 */
const REDACTED_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'secret',
  'apiKey',
  'refreshToken',
]);

function sanitise(context: LogContext): LogContext {
  const clean: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (REDACTED_KEYS.has(key)) {
      clean[key] = '[redacted]';
      continue;
    }
    if (value === undefined) continue; // Absent beats null in a log line.
    clean[key] = value;
  }
  return clean;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < minLevel()) return;

  const fields = sanitise(context);
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (process.env.NODE_ENV === 'production') {
    write(JSON.stringify({ level, msg: message, time: new Date().toISOString(), ...fields }));
    return;
  }

  const suffix = Object.keys(fields).length
    ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${format(v)}`).join(' ')
    : '';
  write(`[${level}] ${message}${suffix}`);
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return JSON.stringify(value);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),

  /**
   * Binds context once so a call site does not repeat it on every line.
   * Used by the request middleware to stamp requestId and userId.
   */
  child(base: LogContext) {
    return {
      debug: (message: string, context?: LogContext) => emit('debug', message, { ...base, ...context }),
      info: (message: string, context?: LogContext) => emit('info', message, { ...base, ...context }),
      warn: (message: string, context?: LogContext) => emit('warn', message, { ...base, ...context }),
      error: (message: string, context?: LogContext) => emit('error', message, { ...base, ...context }),
    };
  },
};

export type Logger = ReturnType<typeof logger.child>;
