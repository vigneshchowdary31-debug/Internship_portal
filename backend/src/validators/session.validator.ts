import { z } from 'zod';

export const createSessionSchema = z.object({
  body: z.object({
    title: z.string({ required_error: 'Title is required' }).min(3),
    description: z.string().optional(),
    batchId: z.string({ required_error: 'Batch ID is required' }).uuid(),
    instructorId: z.string({ required_error: 'Instructor ID is required' }).uuid(),
    startTime: z.string({ required_error: 'Start time is required' }).refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid start time format (must be ISO date string)',
    }),
    durationMinutes: z.number({ required_error: 'Duration is required' }).min(15).max(480),
  }),
});

export const updateSessionSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    title: z.string().min(3).optional(),
    description: z.string().optional(),
    status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  }),
});
