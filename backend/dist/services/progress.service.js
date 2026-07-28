"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressService = void 0;
const db_1 = __importDefault(require("../config/db"));
class ProgressService {
    static async updateProgress(data) {
        // Upsert to handle prevent duplicates and keep 1 record per techStack per student
        const record = await db_1.default.studentProgress.upsert({
            where: {
                studentId_techStackId: {
                    studentId: data.studentId,
                    techStackId: data.techStackId,
                }
            },
            update: {
                progress: data.progress,
                level: data.level,
                notes: data.notes,
                lastUpdated: new Date()
            },
            create: {
                studentId: data.studentId,
                techStackId: data.techStackId,
                progress: data.progress,
                level: data.level,
                notes: data.notes,
            }
        });
        return record;
    }
    static async getStudentProgress(studentId) {
        return await db_1.default.studentProgress.findMany({
            where: { studentId },
            include: {
                techStack: true,
            },
            orderBy: {
                lastUpdated: 'desc'
            }
        });
    }
    static async getOverview(filters) {
        // Used by Admin for general overview
        return await db_1.default.studentProgress.findMany({
            where: filters,
            include: {
                student: { select: { id: true, name: true, studentBatches: { include: { batch: true } } } },
                techStack: true
            },
            orderBy: { progress: 'asc' } // Lowest progress first for attention
        });
    }
}
exports.ProgressService = ProgressService;
