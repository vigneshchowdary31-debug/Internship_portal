/**
 * Operational limits, in one place and overridable per environment.
 *
 * These were literals scattered across the queue, the routes and the
 * validators. They are the numbers an operator needs to change at 3am when a
 * cohort is three times bigger than expected, and hunting them through source
 * files is the wrong thing to be doing at that point.
 *
 * Every one has a default that matches the behaviour before this file existed,
 * so an environment that sets nothing behaves exactly as it did.
 */

/** Parses an env var as a positive integer, falling back on anything invalid. */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    // A typo'd limit that silently became NaN would disable the guard it was
    // meant to enforce, so it is announced and the safe default is used.
    console.warn(`[config] ${name}="${raw}" is not a positive integer; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

export const limits = {
  email: {
    /** Jobs held in memory before new ones are shed. */
    queueMaxLength: intFromEnv('EMAIL_QUEUE_MAX_LENGTH', 5000),
    /** Attempts per job, counting the first. Only transient failures retry. */
    maxAttempts: intFromEnv('EMAIL_MAX_ATTEMPTS', 3),
    /** First retry delay; doubles each attempt. */
    retryBaseMs: intFromEnv('EMAIL_RETRY_BASE_MS', 2000),
    /**
     * How long shutdown waits for the queue to finish. Kubernetes sends SIGKILL
     * 30s after SIGTERM by default, so this stays comfortably inside that.
     */
    shutdownDrainMs: intFromEnv('EMAIL_SHUTDOWN_DRAIN_MS', 10000),
  },

  grading: {
    /** Submissions per bulk request. Also bounds the body-size ceiling. */
    bulkMaxItems: intFromEnv('BULK_GRADE_MAX_ITEMS', 100),
    /** Bulk requests per window, per IP. */
    bulkRateMax: intFromEnv('BULK_GRADE_RATE_MAX', 20),
    /** Single-grade requests per window, per IP. Marking is bursty; be generous. */
    singleRateMax: intFromEnv('GRADE_RATE_MAX', 300),
    rateWindowMs: intFromEnv('GRADE_RATE_WINDOW_MS', 15 * 60 * 1000),
    /** Body ceiling for the bulk route only — the app-wide limit is 10kb. */
    bulkBodyLimit: process.env.BULK_GRADE_BODY_LIMIT || '512kb',
  },

  db: {
    /**
     * Server-side statement timeout, in milliseconds.
     *
     * A query that has run this long is not going to succeed usefully; without
     * a ceiling it holds a pooled connection until the client gives up, and a
     * handful of those exhausts the transaction pooler for everyone.
     */
    statementTimeoutMs: intFromEnv('DB_STATEMENT_TIMEOUT_MS', 15000),
    /** Retries for TRANSIENT failures on read/idempotent work only. */
    maxRetries: intFromEnv('DB_MAX_RETRIES', 2),
    retryBaseMs: intFromEnv('DB_RETRY_BASE_MS', 150),
  },
} as const;
