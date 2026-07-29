"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSessionSchema = exports.createSessionSchema = void 0;
const zod_1 = require("zod");
exports.createSessionSchema = zod_1.z.object({
    body: zod_1.z.object({
        title: zod_1.z.string({ message: 'Title is required' }).min(3),
        description: zod_1.z.string().optional(),
        batchId: zod_1.z.string({ message: 'Batch ID is required' }).uuid(),
        instructorId: zod_1.z.string({ message: 'Instructor ID is required' }).uuid(),
        startTime: zod_1.z.string({ message: 'Start time is required' }).refine((val) => !isNaN(Date.parse(val)), {
            message: 'Invalid start time format (must be ISO date string)',
        }),
        durationMinutes: zod_1.z.number({ message: 'Duration is required' }).min(15).max(480),
    }),
});
exports.updateSessionSchema = zod_1.z.object({
    params: zod_1.z.object({
        id: zod_1.z.string().uuid(),
    }),
    body: zod_1.z.object({
        title: zod_1.z.string().min(3).optional(),
        description: zod_1.z.string().optional(),
        status: zod_1.z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
    }),
});
