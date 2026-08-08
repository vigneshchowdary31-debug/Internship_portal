import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as submissions from '../controllers/submission.controller';
import { limits } from '../config/limits';
import {
  createSubmissionSchema,
  listSubmissionsSchema,
  gradeSubmissionSchema,
  bulkGradeSchema,
  submissionIdSchema,
} from '../validators/submission.validator';

/**
 * Submission routes — Phase 3, M2.
 *
 * Mounted at /api/submissions. The file itself never passes through here: the
 * browser uploads directly to Cloudinary using a ticket from
 * POST /api/lms/uploads/sign, then POSTs the provider's response to this
 * router, which hands it to StorageService.confirmUpload(). That is what keeps
 * `express.json({ limit: '10kb' })` viable with 25 MB submissions.
 */
const router = Router();

router.use(authenticate);

/**
 * Bulk grading, declared before the parameterised routes.
 *
 * It mounts its OWN body parser. The app-wide `express.json({ limit: '10kb' })`
 * exists to keep large payloads away from every ordinary endpoint, and a batch
 * of a hundred marks with written feedback exceeds it immediately — the request
 * would fail as a bare 413 with no field-level explanation. Raising the limit
 * globally to fix one route would drop that protection everywhere, so the
 * larger parser is scoped to this handler alone, and the validator's 100-item
 * cap is what keeps its ceiling meaningful.
 */
/**
 * A second limiter, on top of the app-wide one.
 *
 * This endpoint is the most expensive authenticated write in the system: up to
 * 100 rows in a transaction plus a fan-out of digest emails. The global limit
 * (100 requests / 15 min across all of /api) would let a client spend its whole
 * budget here. Grading is bursty but not rapid — a marker submits a page at a
 * time — so 20 batches per 15 minutes is generous for the real workflow and
 * still bounds the damage from a runaway client.
 */
/**
 * Rate-limit bodies carry BOTH shapes, exactly as the error handler does.
 *
 * express-rate-limit answers directly and never reaches `errorHandler`, so the
 * dual shape has to be written out here too — the flat `message` is what the
 * shipped frontend's `errorMessage()` reads, and dropping it would turn a
 * useful "slow down" into "Something went wrong".
 */
const rateLimitBody = (message: string) => ({
  success: false,
  error: { message, code: 'RATE_LIMITED' },
  message,
});

const bulkGradeLimiter = rateLimit({
  windowMs: limits.grading.rateWindowMs,
  max: limits.grading.bulkRateMax,
  message: rateLimitBody('Too many bulk grading requests. Please wait a moment and try again.'),
});

/**
 * Single grading gets its own, far higher, allowance.
 *
 * Marking one paper at a time is the normal workflow, so this must not get in a
 * marker's way — it exists only to bound a script hammering the endpoint. The
 * app-wide limiter (100 requests / 15 min across ALL of /api) would otherwise
 * stop an instructor after their hundredth action of the afternoon, which is a
 * realistic morning's marking.
 */
const gradeLimiter = rateLimit({
  windowMs: limits.grading.rateWindowMs,
  max: limits.grading.singleRateMax,
  message: rateLimitBody('Too many grading requests. Please slow down.'),
});

router.patch(
  '/bulk-grade',
  bulkGradeLimiter,
  express.json({ limit: limits.grading.bulkBodyLimit }),
  validate(bulkGradeSchema),
  submissions.bulkGradeSubmissions
);

router.get('/', validate(listSubmissionsSchema), submissions.listSubmissions);
router.post('/', validate(createSubmissionSchema), submissions.createSubmission);
router.get('/:id', validate(submissionIdSchema), submissions.getSubmission);
router.patch('/:id/grade', gradeLimiter, validate(gradeSubmissionSchema), submissions.gradeSubmission);
router.delete('/:id', validate(submissionIdSchema), submissions.deleteSubmission);

export default router;
