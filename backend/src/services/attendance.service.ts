import prisma from '../config/db';
import { AppError } from '../utils/AppError';
import { Prisma } from '@prisma/client';

export class AttendanceService {
  static async markAttendance(data: {
    sessionId: string;
    studentId: string;
    status: any;
    remarks?: string;
    markedBy: string;
  }) {
    // Verify session exists and is not cancelled
    const session = await prisma.session.findUnique({
      where: { id: data.sessionId }
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }
    
    if (session.status === 'CANCELLED') {
      throw new AppError('Cannot mark attendance for a cancelled session', 400);
    }

    // Upsert to handle prevent duplicates effectively
    // If it exists, update it. If not, create it.
    // The requirement says "Prevent duplicates", so upsert is perfect.
    const record = await prisma.attendance.upsert({
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

  static async updateAttendance(id: string, data: { status?: any; remarks?: string; markedBy: string }) {
    const exists = await prisma.attendance.findUnique({ where: { id } });
    if (!exists) {
      throw new AppError('Attendance record not found', 404);
    }

    return await prisma.attendance.update({
      where: { id },
      data: {
        ...data,
      }
    });
  }

  static async getSessionAttendance(sessionId: string) {
    return await prisma.attendance.findMany({
      where: { sessionId },
      include: {
        student: { select: { id: true, name: true, email: true } }
      }
    });
  }

  static async getStudentAttendance(studentId: string) {
    return await prisma.attendance.findMany({
      where: { studentId },
      include: {
        session: { include: { batch: true, instructor: { select: { id: true, name: true } } } }
      },
      orderBy: {
        session: { startTime: 'desc' }
      }
    });
  }

  static async getOverview(filters?: any) {
    // Used by Admin for general overview
    return await prisma.attendance.findMany({
      where: filters,
      include: {
        session: { include: { batch: true } },
        student: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
