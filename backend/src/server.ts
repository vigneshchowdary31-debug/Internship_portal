import 'dotenv/config';
import './config/env';
import app from './app';
import prisma from './config/db';
import { EmailService } from './services/email.service';
import { emailQueue } from './services/email/email-queue';
import { limits } from './config/limits';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 5001;
let server: any;

async function startServer() {
  try {
    // Attempt to connect to the database
    await prisma.$connect();
    console.log('✅ Connected to database successfully');

    server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);

      // Email diagnostics run after the server is listening and are never
      // awaited: an unreachable SMTP host must not delay or block startup.
      if (process.env.SMTP_STARTUP_DIAGNOSTICS !== 'false') {
        void EmailService.runStartupDiagnostics();
      }
    });
  } catch (error) {
    console.error('❌ Failed to connect to the database', error);
    process.exit(1);
  }
}

startServer();

// --- Graceful Shutdown ---

/**
 * Shuts down in the order that loses the least work:
 *
 *   1. Stop accepting new connections, and let in-flight requests finish.
 *   2. DRAIN THE EMAIL QUEUE. Jobs live in memory, so exiting first discards
 *      every notification email queued in the last few seconds — exactly the
 *      ones a deploy mid-grading-session would produce.
 *   3. Close the database.
 *
 * Bounded by a timeout, because a wedged SMTP server must not stop a deploy:
 * the platform sends SIGKILL some seconds after SIGTERM regardless, and being
 * killed mid-`$disconnect` is worse than abandoning a few emails.
 */
let shuttingDown = false;

const shutdown = async (signal: string) => {
  // A second Ctrl-C should not start a parallel shutdown; the impatient
  // operator gets an immediate exit instead.
  if (shuttingDown) {
    logger.warn('Second shutdown signal — exiting immediately', { signal });
    process.exit(1);
  }
  shuttingDown = true;

  logger.info('Shutdown signal received', { signal });

  const hardExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit', {
      pendingEmails: emailQueue.size,
    });
    process.exit(1);
  }, limits.email.shutdownDrainMs + 5000);
  // Do not let this timer alone keep the process alive.
  hardExit.unref();

  try {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      logger.info('HTTP server closed');
    }

    const pending = emailQueue.size;
    if (pending > 0) {
      logger.info('Draining email queue before exit', { count: pending });
    }

    await Promise.race([
      emailQueue.drain(),
      new Promise<void>((resolve) => setTimeout(resolve, limits.email.shutdownDrainMs)),
    ]);

    if (emailQueue.size > 0) {
      logger.warn('Exiting with email jobs still queued', { count: emailQueue.size });
    } else {
      logger.info('Email queue drained');
    }

    await prisma.$disconnect();
    logger.info('Database connection closed');

    clearTimeout(hardExit);
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error?.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Optional: In production you might want to shutdown on unhandled rejections
});
