import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { limits } from './limits';
import { logger } from '../utils/logger';

/**
 * Application runtime pool — DATABASE_URL, the TRANSACTION pooler (port 6543).
 *
 * Deliberately NOT DIRECT_URL. Transaction-mode pooling is what lets many
 * short-lived app queries share a small number of Postgres backends, which is
 * exactly right for request/response traffic.
 *
 * The Prisma CLI is configured separately in prisma.config.ts and points at
 * DIRECT_URL (session pooler, 5432), because migrations need one durable
 * session to hold an advisory lock. Do not converge these two on one URL:
 *   - runtime on 5432  -> exhausts session-pooler slots under load
 *   - migrations on 6543 -> hangs forever acquiring the advisory lock
 */
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  /**
   * Server-side ceiling on any single statement (Phase 7).
   *
   * Enforced by PostgreSQL rather than by the client, so it holds even if the
   * Node process stops waiting. A query still running after this is not going
   * to succeed usefully, and until it is killed it holds a pooled connection —
   * a handful of those exhausts the transaction pooler for every other request.
   */
  statement_timeout: limits.db.statementTimeoutMs,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;

/**
 * PostgreSQL error codes and Prisma codes worth a second attempt.
 *
 * Strictly connection-level: a dropped socket, a pooler that recycled the
 * backend, a timed-out checkout. A constraint violation or a bad query is
 * deterministic and retrying it only doubles the latency before the same error.
 */
const TRANSIENT_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Server reached but timed out
  'P1008', // Operation timed out
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a connection from the pool
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '57P01', // admin_shutdown
]);

function isTransient(error: any): boolean {
  const code = error?.code ?? error?.meta?.code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
  return /ECONNRESET|ETIMEDOUT|EPIPE|Connection terminated/i.test(error?.message ?? '');
}

/**
 * Retries a database operation on TRANSIENT failures only.
 *
 * ⚠️ READS AND IDEMPOTENT WRITES ONLY.
 *
 * This is deliberately NOT applied blanket-wide. A `create` that timed out may
 * well have committed before the connection dropped, so retrying it can produce
 * a duplicate — and for a submission or a mark, a silent duplicate is worse
 * than a visible error the caller can act on. Callers opt in where they know
 * the operation is safe to repeat.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  context: { label: string } = { label: 'query' }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= limits.db.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === limits.db.maxRetries) break;

      const delay = limits.db.retryBaseMs * 2 ** attempt;
      logger.warn('Transient database failure; retrying', {
        label: context.label,
        attempt: attempt + 1,
        delayMs: delay,
        error: (error as Error)?.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
