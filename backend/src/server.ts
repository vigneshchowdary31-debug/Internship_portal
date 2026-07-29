import 'dotenv/config';
import './config/env';
import app from './app';
import prisma from './config/db';
import { EmailService } from './services/email.service';

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
const shutdown = async (signal: string) => {
  console.log(`\n${signal} signal received: closing HTTP server`);
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed');
      await prisma.$disconnect();
      console.log('Database connection closed');
      process.exit(0);
    });
  } else {
    await prisma.$disconnect();
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Optional: In production you might want to shutdown on unhandled rejections
});
