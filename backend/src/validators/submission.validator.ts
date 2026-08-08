import { z } from 'zod';
import { limits } from '../config/limits';

/**
 * Submission request validation (Phase 3, M2).
 *
 * The create body is Cloudinary's UPLOAD RESPONSE, echoed by the browser after
 * a direct upload. Two fields carry the bugs this schema exists to stop:
 *
 *   - `providerKey` must be the `public_id` Cloudinary RETURNED, not the one we
 *     signed. For `raw` assets Cloudinary appends the extension, and storing the
 *     signed key makes every later delete a silent no-op.
 *   - `resourceType` is REQUIRED, and constrained to the three values the
 *     destroy endpoint accepts. `auto` is an upload-only convenience and is
 *     rejected by destroy with a 400, so a submission registered without a
 *     usable resource type is a file that can never be deleted.
 *
 * `format` stays optional because Cloudinary genuinely omits it for `raw`
 * assets — the schema comment on MediaAsset says so. Requiring it would reject
 * every .zip a student hands in.
 */

const id = z.string().uuid('Invalid id format');

const pageNumber = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();

/** Query-string booleans arrive as strings; coerced rather than rejected. */
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const createSubmissionSchema = z.object({
  body: z.object({
    assignmentId: id,
    providerKey: z.string().trim().min(1).max(500),
    url: z.string().trim().url('Must be a valid URL').max(2000),
    originalFilename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().positive('File appears to be empty'),
    resourceType: z.enum(['image', 'raw', 'video'], {
      errorMap: () => ({
        message: "resourceType must be image, raw or video — Cloudinary's destroy endpoint rejects 'auto'",
      }),
    }),
    format: z.string().trim().max(32).optional(),
    checksum: z.string().trim().max(128).optional(),
  }),
});

export const listSubmissionsSchema = z.object({
  query: z.object({
    assignmentId: id.optional(),
    studentId: id.optional(),
    isLate: queryBoolean,
    graded: queryBoolean,
    page: pageNumber,
    pageSize,
  }),
});

export const gradeSubmissionSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    // Upper bound is the assignment's own maxMarks and cannot be known here;
    // the service checks it against the row. This only stops absurd input.
    marks: z.number().int('Marks must be a whole number').min(0).max(1000),
    feedback: z.string().trim().max(4000).nullable().optional(),
  }),
});

export const submissionIdSchema = z.object({ params: z.object({ id }) });

/**
 * Bulk grading (Phase 5).
 *
 * The body is a bare array, per the Phase 5 contract.
 *
 * ── WHY THE 100-ITEM CAP ─────────────────────────────────────────────────────
 * The app parses bodies with `express.json({ limit: '10kb' })`, which a batch of
 * marks-plus-feedback blows through immediately. The bulk route therefore
 * mounts its own larger parser (see submission.routes.ts), and this cap is what
 * keeps that parser's ceiling meaningful rather than unbounded: 100 items at the
 * 4000-character feedback maximum is the worst case it has to hold.
 *
 * Duplicate submission ids are REJECTED rather than last-write-wins. Two
 * different marks for one submission in a single request is a client bug, and
 * silently applying whichever came last would record a mark the instructor
 * never chose.
 */
export const bulkGradeSchema = z.object({
  body: z
    .array(
      z.object({
        submissionId: id,
        marks: z.number().int('Marks must be a whole number').min(0).max(1000),
        feedback: z.string().trim().max(4000).nullable().optional(),
      })
    )
    .min(1, 'Provide at least one submission to mark')
    .max(limits.grading.bulkMaxItems, `Mark at most ${limits.grading.bulkMaxItems} submissions per request`)
    .refine(
      (items) => new Set(items.map((i) => i.submissionId)).size === items.length,
      { message: 'The same submission appears more than once' }
    ),
});

export const gradingProgressSchema = z.object({ params: z.object({ id }) });
