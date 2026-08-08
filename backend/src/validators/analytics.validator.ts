import { z } from 'zod';

/**
 * Analytics request validation (Phase 4).
 *
 * Read-only endpoints, so this is purely about rejecting malformed ids before
 * they reach a query. Every authorization decision — whose data, which batches —
 * is made in the controller against the policy layer, never from a parameter.
 */

const id = z.string().uuid('Invalid id format');

export const studentAnalyticsSchema = z.object({
  query: z.object({
    /** Admin/instructor only; the controller enforces that. */
    studentId: id.optional(),
  }),
});

export const courseAnalyticsSchema = z.object({
  params: z.object({ learningPathId: id }),
});

export const assignmentAnalyticsSchema = z.object({
  params: z.object({ id }),
});

export const atRiskSchema = z.object({
  query: z.object({
    batchId: id.optional(),
  }),
});
