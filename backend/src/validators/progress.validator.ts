import { z } from 'zod';

export const progressLevelEnum = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);

export const updateProgressSchema = z.object({
  body: z.object({
    studentId: z.string().uuid('Invalid student ID format'),
    techStackId: z.string().uuid('Invalid tech stack ID format'),
    progress: z.number().min(0).max(100),
    level: progressLevelEnum,
    notes: z.string().optional(),
  }),
});
