"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
const db_1 = __importDefault(require("../config/db"));
const AppError_1 = require("../utils/AppError");
const google_service_1 = require("./google.service");
const email_service_1 = require("./email.service");
class SessionService {
    static async createSession(data) {
        // 1. Verify Batch & Instructor
        const batch = await db_1.default.batch.findUnique({
            where: { id: data.batchId },
            include: {
                studentBatches: {
                    include: { student: true },
                },
            },
        });
        if (!batch) {
            throw new AppError_1.AppError('Batch not found', 404);
        }
        const instructor = await db_1.default.user.findUnique({
            where: { id: data.instructorId, role: 'INSTRUCTOR' },
        });
        if (!instructor) {
            throw new AppError_1.AppError('Instructor not found', 404);
        }
        // 2. Calculate End Time
        const startDate = new Date(data.startTime);
        const endDate = new Date(startDate.getTime() + data.durationMinutes * 60000);
        // 3. Generate Google Meet
        let meetLink = null;
        let eventId = null;
        let meetingCode = null;
        try {
            const meetData = await google_service_1.GoogleService.createMeetEvent(data.title, data.description || `Class for ${batch.name}`, startDate, endDate);
            meetLink = meetData.meetLink || null;
            eventId = meetData.eventId || null;
            meetingCode = meetData.meetingCode || null;
        }
        catch (error) {
            console.error('Failed to integrate with Google Meet during session creation:', error.message, error.stack);
            // For MVP we might still want to create the DB record even if Meet fails, 
            // or we can throw. I'll throw to ensure data consistency as requested by "Heart of the system".
            throw new AppError_1.AppError(error.message || 'Failed to generate Google Meet link', 500);
        }
        // 4. Create Session in Database
        const session = await db_1.default.session.create({
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
        // 5. Send Email Notifications
        const studentEmails = batch.studentBatches
            .map((sb) => sb.student.email)
            .filter((email) => !!email);
        const allEmails = [...studentEmails, instructor.email];
        if (meetLink && allEmails.length > 0) {
            await email_service_1.EmailService.sendSessionNotification(allEmails, session.title, session.startTime, meetLink, instructor.name, batch.name);
        }
        return session;
    }
    static async getSessions(filters) {
        const sessions = await db_1.default.session.findMany({
            where: filters,
            include: {
                batch: { select: { name: true } },
                instructor: { select: { name: true } },
            },
            orderBy: { startTime: 'asc' },
        });
        return sessions;
    }
    static async updateSession(id, data) {
        const session = await db_1.default.session.findUnique({ where: { id } });
        if (!session)
            throw new AppError_1.AppError('Session not found', 404);
        let startDate = session.startTime;
        let endDate = session.endTime;
        let needsGoogleUpdate = false;
        if (data.startTime || data.durationMinutes) {
            if (data.startTime)
                startDate = new Date(data.startTime);
            const duration = data.durationMinutes || Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000);
            endDate = new Date(startDate.getTime() + duration * 60000);
            needsGoogleUpdate = true;
        }
        if ((data.title && data.title !== session.title) ||
            (data.description !== undefined && data.description !== session.description)) {
            needsGoogleUpdate = true;
        }
        const updatedSession = await db_1.default.session.update({
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
                await google_service_1.GoogleService.updateMeetEvent(updatedSession.googleEventId, updatedSession.title, updatedSession.description || '', updatedSession.startTime, updatedSession.endTime);
            }
            catch (error) {
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
                await email_service_1.EmailService.sendSessionUpdateNotification(allEmails, updatedSession.title, updatedSession.startTime, updatedSession.googleMeetLink || '', updatedSession.instructor.name, updatedSession.batch.name).catch(err => {
                    console.error('Failed to send update emails', err);
                });
            }
        }
        return updatedSession;
    }
    static async cancelSession(id) {
        const session = await db_1.default.session.findUnique({
            where: { id },
            include: {
                batch: { include: { studentBatches: { include: { student: true } } } },
                instructor: true,
            },
        });
        if (!session)
            throw new AppError_1.AppError('Session not found', 404);
        if (session.status === 'CANCELLED')
            throw new AppError_1.AppError('Session is already cancelled', 400);
        const updatedSession = await db_1.default.session.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });
        if (session.googleEventId) {
            await google_service_1.GoogleService.deleteMeetEvent(session.googleEventId);
        }
        // Send Cancellation Emails
        const studentEmails = session.batch.studentBatches
            .map((sb) => sb.student.email)
            .filter(Boolean);
        const allEmails = [...studentEmails, session.instructor.email];
        if (allEmails.length > 0) {
            await email_service_1.EmailService.sendCancellationNotification(allEmails, session.title, session.startTime, session.instructor.name, session.batch.name).catch(err => {
                console.error('Failed to send cancellation emails', err);
            });
        }
        return updatedSession;
    }
    static async deleteSession(id) {
        const session = await db_1.default.session.findUnique({ where: { id } });
        if (!session)
            throw new AppError_1.AppError('Session not found', 404);
        if (session.googleEventId) {
            await google_service_1.GoogleService.deleteMeetEvent(session.googleEventId);
        }
        await db_1.default.session.delete({ where: { id } });
        return true;
    }
}
exports.SessionService = SessionService;
