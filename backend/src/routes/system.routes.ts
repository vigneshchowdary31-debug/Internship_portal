import { Router, Request, Response } from 'express';
import prisma from '../config/db';
import { emailQueue } from '../services/email/email-queue';
import { limits } from '../config/limits';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Operational health — Phase 7. Mounted at /api/system.
 *
 * Deliberately UNAUTHENTICATED, matching the existing /api/health: a load
 * balancer or uptime probe has no credentials, and a health check that needs a
 * token is a health check nobody wires up. It exposes no user data — a queue
 * depth, an uptime and whether the database answered.
 *
 * If that is more than you want public, mounting this behind `authenticate` and
 * an ADMIN check is a two-line change; the trade is that your probe then needs
 * a service account.
 */
const router = Router();

/**
 * `SELECT 1` with its own deadline.
 *
 * The pool's statement_timeout would eventually fire, but a health endpoint
 * that hangs for fifteen seconds gets the instance killed by the very probe it
 * was meant to reassure. Two seconds is long enough for a healthy round trip
 * and short enough to answer within any sane probe timeout.
 */
async function checkDatabase(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return { status: 'up', latencyMs: Date.now() - started };
  } catch {
    return { status: 'down', latencyMs: Date.now() - started };
  }
}

router.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    const db = await checkDatabase();
    const queueSize = emailQueue.size;
    const isQueueFull = queueSize >= limits.email.queueMaxLength;

    // 503 when the database is unreachable so an orchestrator actually acts on
    // it. A full email queue is NOT unhealthy — mail is degraded, the app is
    // not, and taking the instance out of rotation would make things worse.
    const healthy = db.status === 'up';

    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? 'healthy' : 'degraded',
        uptime: Math.floor(process.uptime()),
        queueSize,
        isQueueFull,
        queueCapacity: limits.email.queueMaxLength,
        dbStatus: db.status,
        dbLatencyMs: db.latencyMs,
        timestamp: new Date().toISOString(),
      },
    });
  })
);

export default router;
