import { z } from 'zod';

export const createSessionSchema = z.object({
  body: z.object({
    title: z.string({ message: 'Title is required' }).min(3),
    description: z.string().optional(),
    batchId: z.string({ message: 'Batch ID is required' }).uuid(),
    instructorId: z.string({ message: 'Instructor ID is required' }).uuid(),
    startTime: z.string({ message: 'Start time is required' }).refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid start time format (must be ISO date string)',
    }),
    durationMinutes: z.number({ message: 'Duration is required' }).min(15).max(480),
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
