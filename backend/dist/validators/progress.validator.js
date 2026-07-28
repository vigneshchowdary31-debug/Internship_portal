"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProgressSchema = exports.progressLevelEnum = void 0;
const zod_1 = require("zod");
exports.progressLevelEnum = zod_1.z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
exports.updateProgressSchema = zod_1.z.object({
    body: zod_1.z.object({
        studentId: zod_1.z.string().uuid('Invalid student ID format'),
        techStackId: zod_1.z.string().uuid('Invalid tech stack ID format'),
        progress: zod_1.z.number().min(0).max(100),
        level: exports.progressLevelEnum,
        notes: zod_1.z.string().optional(),
    }),
});
