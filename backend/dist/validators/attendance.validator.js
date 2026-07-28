"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAttendanceSchema = exports.markAttendanceSchema = exports.attendanceStatusEnum = void 0;
const zod_1 = require("zod");
exports.attendanceStatusEnum = zod_1.z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
exports.markAttendanceSchema = zod_1.z.object({
    body: zod_1.z.object({
        sessionId: zod_1.z.string().uuid('Invalid session ID format'),
        studentId: zod_1.z.string().uuid('Invalid student ID format'),
        status: exports.attendanceStatusEnum,
        remarks: zod_1.z.string().optional(),
    }),
});
exports.updateAttendanceSchema = zod_1.z.object({
    params: zod_1.z.object({
        id: zod_1.z.string().uuid('Invalid attendance ID format'),
    }),
    body: zod_1.z.object({
        status: exports.attendanceStatusEnum.optional(),
        remarks: zod_1.z.string().optional(),
    }),
});
