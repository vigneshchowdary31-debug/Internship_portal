"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
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
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
exports.default = prisma;
