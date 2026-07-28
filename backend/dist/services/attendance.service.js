"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttendanceService = void 0;
const db_1 = __importDefault(require("../config/db"));
const AppError_1 = require("../utils/AppError");
class AttendanceService {
    static async markAttendance(data) {
        // Verify session exists and is not cancelled
        const session = await db_1.default.session.findUnique({
            where: { id: data.sessionId }
        });
        if (!session) {
            throw new AppError_1.AppError('Session not found', 404);
        }
        if (session.status === 'CANCELLED') {
            throw new AppError_1.AppError('Cannot mark attendance for a cancelled session', 400);
        }
        // Upsert to handle prevent duplicates effectively
        // If it exists, update it. If not, create it.
        // The requirement says "Prevent duplicates", so upsert is perfect.
        const record = await db_1.default.attendance.upsert({
            where: {
                sessionId_studentId: {
                    sessionId: data.sessionId,
                    studentId: data.studentId,
                }
            },
            update: {
                status: data.status,
                remarks: data.remarks,
                markedBy: data.markedBy,
            },
            create: {
                sessionId: data.sessionId,
                studentId: data.studentId,
                status: data.status,
                remarks: data.remarks,
                markedBy: data.markedBy,
            }
        });
        return record;
    }
    static async updateAttendance(id, data) {
        const exists = await db_1.default.attendance.findUnique({ where: { id } });
        if (!exists) {
            throw new AppError_1.AppError('Attendance record not found', 404);
        }
        return await db_1.default.attendance.update({
            where: { id },
            data: {
                ...data,
            }
        });
    }
    static async getSessionAttendance(sessionId) {
        return await db_1.default.attendance.findMany({
            where: { sessionId },
            include: {
                student: { select: { id: true, name: true, email: true } }
            }
        });
    }
    static async getStudentAttendance(studentId) {
        return await db_1.default.attendance.findMany({
            where: { studentId },
            include: {
                session: { include: { batch: true, instructor: { select: { id: true, name: true } } } }
            },
            orderBy: {
                session: { startTime: 'desc' }
            }
        });
    }
    static async getOverview(filters) {
        // Used by Admin for general overview
        return await db_1.default.attendance.findMany({
            where: filters,
            include: {
                session: { include: { batch: true } },
                student: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    }
}
exports.AttendanceService = AttendanceService;
