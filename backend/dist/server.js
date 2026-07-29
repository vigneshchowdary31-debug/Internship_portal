"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
require("./config/env");
const app_1 = __importDefault(require("./app"));
const db_1 = __importDefault(require("./config/db"));
const email_service_1 = require("./services/email.service");
const PORT = process.env.PORT || 5001;
let server;
async function startServer() {
    try {
        // Attempt to connect to the database
        await db_1.default.$connect();
        console.log('✅ Connected to database successfully');
        server = app_1.default.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            // Email diagnostics run after the server is listening and are never
            // awaited: an unreachable SMTP host must not delay or block startup.
            if (process.env.SMTP_STARTUP_DIAGNOSTICS !== 'false') {
                void email_service_1.EmailService.runStartupDiagnostics();
            }
        });
    }
    catch (error) {
        console.error('❌ Failed to connect to the database', error);
        process.exit(1);
    }
}
startServer();
// --- Graceful Shutdown ---
const shutdown = async (signal) => {
    console.log(`\n${signal} signal received: closing HTTP server`);
    if (server) {
        server.close(async () => {
            console.log('HTTP server closed');
            await db_1.default.$disconnect();
            console.log('Database connection closed');
            process.exit(0);
        });
    }
    else {
        await db_1.default.$disconnect();
        process.exit(0);
    }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Optional: In production you might want to shutdown on unhandled rejections
});
