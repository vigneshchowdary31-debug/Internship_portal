import prisma from '../config/db';
import { AppError } from '../utils/AppError';

export class ProgressService {
  static async updateProgress(data: {
    studentId: string;
    techStackId: string;
    progress: number;
    level: any;
    notes?: string;
  }) {
    // Upsert to handle prevent duplicates and keep 1 record per techStack per student
    const record = await prisma.studentProgress.upsert({
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

  static async getStudentProgress(studentId: string) {
    return await prisma.studentProgress.findMany({
      where: { studentId },
      include: {
        techStack: true,
      },
      orderBy: {
        lastUpdated: 'desc'
      }
    });
  }

  static async getOverview(filters?: any) {
    // Used by Admin for general overview
    return await prisma.studentProgress.findMany({
      where: filters,
      include: {
        student: { select: { id: true, name: true, studentBatches: { include: { batch: true } } } },
        techStack: true
      },
      orderBy: { progress: 'asc' } // Lowest progress first for attention
    });
  }
}
