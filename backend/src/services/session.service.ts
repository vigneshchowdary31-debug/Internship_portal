import prisma from '../config/db';
import { AppError } from '../utils/AppError';
import { GoogleService } from './google.service';
import { EmailService } from './email.service';

export class SessionService {
  static async createSession(data: {
    title: string;
    description?: string;
    batchId: string;
    instructorId: string;
    startTime: string;
    durationMinutes: number;
  }) {
    console.log(`\n--- Start Session Creation ---`);
    const startTimeOverall = performance.now();
    let stepStart = performance.now();

    // 1. Verify Batch & Instructor (Concurrent)
    const [batch, instructor] = await Promise.all([
      prisma.batch.findUnique({
        where: { id: data.batchId },
        include: {
          studentBatches: {
            include: { student: true },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: data.instructorId, role: 'INSTRUCTOR' },
      })
    ]);

    console.log(`Database Validation: ${(performance.now() - stepStart).toFixed(2)}ms`);

    if (!batch) throw new AppError('Batch not found', 404);
    if (!instructor) throw new AppError('Instructor not found', 404);

    // 2. Calculate End Time
    const startDate = new Date(data.startTime);
    const endDate = new Date(startDate.getTime() + data.durationMinutes * 60000);

    // 3. Generate Google Meet
    let meetLink: string | null = null;
    let eventId: string | null = null;
    let meetingCode: string | null = null;

    stepStart = performance.now();
    console.log(`Creating calendar event...`);
    try {
      const meetData = await GoogleService.createMeetEvent(
        data.title,
        data.description || `Class for ${batch.name}`,
        startDate,
        endDate
      );
      meetLink = meetData.meetLink || null;
      eventId = meetData.eventId || null;
      meetingCode = meetData.meetingCode || null;
      console.log(`Google Calendar/Meet: ${(performance.now() - stepStart).toFixed(2)}ms`);
      console.log(`Calendar event created, Meet link created`);
    } catch (error: any) {
      console.error(`Google API Error:\n${error.stack || error.message}`);
      console.log(`Google Calendar/Meet: ${(performance.now() - stepStart).toFixed(2)}ms (Failed)`);
      throw new AppError(error.message || 'Failed to generate Google Meet link', 500);
    }

    // 4. Create Session in Database
    stepStart = performance.now();
    const session = await prisma.session.create({
      data: {
        title: data.title,
        description: data.description,
        batchId: data.batchId,
        instructorId: data.instructorId,
        startTime: startDate,
        endTime: endDate,
        googleMeetLink: meetLink,
        googleEventId: eventId,
        meetingCode: meetingCode,
        status: 'SCHEDULED',
      },
      include: {
        batch: true,
        instructor: { select: { name: true, email: true } },
      },
    });
    console.log(`Database Insert: ${(performance.now() - stepStart).toFixed(2)}ms`);

    // 5. Send Email Notifications (Fire and Forget)
    stepStart = performance.now();
    const studentEmails = batch.studentBatches
      .map((sb) => sb.student.email)
      .filter((email) => !!email);
    
    const allEmails = [...studentEmails, instructor.email];

    if (meetLink && allEmails.length > 0) {
      EmailService.sendSessionNotification(
        allEmails,
        session.title,
        session.startTime,
        meetLink,
        instructor.name,
        batch.name
      ).catch(err => {
        console.error(`Email Service Error:\n${err.stack || err.message}`);
      });
      console.log(`Email Triggered: ${(performance.now() - stepStart).toFixed(2)}ms (Async)`);
    }

    console.log(`Total: ${(performance.now() - startTimeOverall).toFixed(2)}ms`);
    console.log(`--- End Session Creation ---\n`);

    return session;
  }

  static async getSessions(filters: { batchId?: string; instructorId?: string }) {
    const sessions = await prisma.session.findMany({
      where: filters,
      include: {
        batch: { select: { name: true } },
        instructor: { select: { name: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    return sessions;
  }

  static async updateSession(
    id: string,
    data: {
      title?: string;
      description?: string;
      startTime?: string;
      durationMinutes?: number;
    }
  ) {
    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) throw new AppError('Session not found', 404);

    let startDate = session.startTime;
    let endDate = session.endTime;
    let needsGoogleUpdate = false;

    if (data.startTime || data.durationMinutes) {
      if (data.startTime) startDate = new Date(data.startTime);
      const duration = data.durationMinutes || Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000);
      endDate = new Date(startDate.getTime() + duration * 60000);
      needsGoogleUpdate = true;
    }

    if (
      (data.title && data.title !== session.title) ||
      (data.description !== undefined && data.description !== session.description)
    ) {
      needsGoogleUpdate = true;
    }

    const updatedSession = await prisma.session.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        startTime: startDate,
        endTime: endDate,
      },
      include: {
        batch: { include: { studentBatches: { include: { student: true } } } },
        instructor: true,
      },
    });

    if (needsGoogleUpdate && updatedSession.googleEventId) {
      try {
        await GoogleService.updateMeetEvent(
          updatedSession.googleEventId,
          updatedSession.title,
          updatedSession.description || '',
          updatedSession.startTime,
          updatedSession.endTime
        );
      } catch (error: any) {
        console.error('Failed to update Google Meet during session update:', error.message, error.stack);
        // We log the error but don't crash, because the DB is already updated
      }
    }

    if (needsGoogleUpdate) {
      // Send Update Emails
      const studentEmails = updatedSession.batch.studentBatches
        .map((sb) => sb.student.email)
        .filter(Boolean);
      const allEmails = [...studentEmails, updatedSession.instructor.email];

      if (allEmails.length > 0) {
        await EmailService.sendSessionUpdateNotification(
          allEmails, 
          updatedSession.title, 
          updatedSession.startTime, 
          updatedSession.googleMeetLink || '',
          updatedSession.instructor.name,
          updatedSession.batch.name
        ).catch(err => {
          console.error(`Failed to send update emails:\n${err.stack || err.message}`);
        });
      }
    }

    return updatedSession;
  }

  static async cancelSession(id: string) {
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        batch: { include: { studentBatches: { include: { student: true } } } },
        instructor: true,
      },
    });

    if (!session) throw new AppError('Session not found', 404);
    if (session.status === 'CANCELLED') throw new AppError('Session is already cancelled', 400);

    const updatedSession = await prisma.session.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    if (session.googleEventId) {
      await GoogleService.deleteMeetEvent(session.googleEventId);
    }

    // Send Cancellation Emails
    const studentEmails = session.batch.studentBatches
      .map((sb) => sb.student.email)
      .filter(Boolean);
    const allEmails = [...studentEmails, session.instructor.email];

    if (allEmails.length > 0) {
      await EmailService.sendCancellationNotification(
        allEmails, 
        session.title, 
        session.startTime,
        session.instructor.name,
        session.batch.name
      ).catch(err => {
        console.error(`Failed to send cancellation emails:\n${err.stack || err.message}`);
      });
    }

    return updatedSession;
  }

  static async deleteSession(id: string) {
    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) throw new AppError('Session not found', 404);

    if (session.googleEventId) {
      await GoogleService.deleteMeetEvent(session.googleEventId);
    }

    await prisma.session.delete({ where: { id } });
    return true;
  }
}
