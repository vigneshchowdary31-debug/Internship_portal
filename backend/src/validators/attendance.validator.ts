import { z } from 'zod';

export const attendanceStatusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

export const markAttendanceSchema = z.object({
  body: z.object({
    sessionId: z.string().uuid('Invalid session ID format'),
    studentId: z.string().uuid('Invalid student ID format'),
    status: attendanceStatusEnum,
    remarks: z.string().optional(),
  }),
});

export const updateAttendanceSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid attendance ID format'),
  }),
  body: z.object({
    status: attendanceStatusEnum.optional(),
    remarks: z.string().optional(),
  }),
});
