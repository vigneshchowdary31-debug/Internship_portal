import { z } from 'zod';

/**
 * Assignment request validation (Phase 3, M1).
 *
 * Shape-only. Whether a deadline is in the FUTURE is checked in
 * AssignmentService, not here: zod would evaluate it against the moment the
 * schema module was imported rather than the moment the request arrives, and
 * the rule needs to hold on the update path too, where the same value can
 * arrive without the field it guards.
 */

const id = z.string().uuid('Invalid id format');
const title = z.string().trim().min(2, 'Must be at least 2 characters').max(200);

/**
 * Rich text from the authoring editor. Capped at 8 000 characters because the
 * app parses bodies with `express.json({ limit: '10kb' })` — a larger cap would
 * be rejected by the body parser as a bare 413 with no field-level explanation.
 */
const description = z
  .string()
  .trim()
  .min(1, 'A description is required')
  .max(8000, 'Description must be under 8000 characters');

const maxMarks = z
  .number()
  .int('Marks must be a whole number')
  .min(1, 'An assignment must be worth at least 1 mark')
  .max(1000, 'Marks must be 1000 or fewer');

const deadline = z.string().datetime({ message: 'Deadline must be an ISO datetime' });

const pageNumber = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();

export const createAssignmentSchema = z.object({
  body: z.object({
    moduleId: id,
    title,
    description,
    maxMarks,
    deadline,
    scope: z.enum(['LEARNING_PATH', 'BATCH']).optional(),
    batchId: id.nullable().optional(),
    /** Phase 3 M2. Defaults to true at the database. */
    allowResubmission: z.boolean().optional(),
    isPublished: z.boolean().optional(),
  }),
});

/**
 * Every field optional, including `isPublished` — one PATCH both edits and
 * publishes, per the Phase 3 API contract. The controller applies the edits
 * first so a deadline extension is in place before the publish gate reads it.
 */
export const updateAssignmentSchema = z.object({
  params: z.object({ id }),
  body: z
    .object({
      title: title.optional(),
      description: description.optional(),
      maxMarks: maxMarks.optional(),
      deadline: deadline.optional(),
      allowResubmission: z.boolean().optional(),
      isPublished: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

export const listAssignmentsSchema = z.object({
  query: z.object({
    moduleId: id.optional(),
    learningPathId: id.optional(),
    batchId: id.optional(),
    q: z.string().trim().max(200).optional(),
    status: z.enum(['draft', 'published', 'all']).optional(),
    dueBefore: z.string().datetime({ message: 'dueBefore must be an ISO datetime' }).optional(),
    dueAfter: z.string().datetime({ message: 'dueAfter must be an ISO datetime' }).optional(),
    sort: z.enum(['deadline', '-deadline', 'createdAt', '-createdAt']).optional(),
    page: pageNumber,
    pageSize,
  }),
});

export const assignmentIdSchema = z.object({ params: z.object({ id }) });
