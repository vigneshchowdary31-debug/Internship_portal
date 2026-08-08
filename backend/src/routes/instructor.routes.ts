import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { assertCanEvaluate } from '../policies/lms.policy';
import * as submissions from '../controllers/submission.controller';
import {
  listSubmissionsSchema,
  gradingProgressSchema,
} from '../validators/submission.validator';

/**
 * Instructor grading routes — Phase 5. Mounted at /api/instructor.
 *
 * `GET /instructor/submissions` is an ALIAS. It points at the very same handler
 * as `GET /api/submissions`, which has been instructor-scoped since Phase 3 M2:
 * `studentWorkScopeFor` already restricts an instructor to the batches they are
 * assigned to, and the response already carries the student, the late flag and
 * the mark. A second implementation under this prefix would be a copy of a
 * working authorization boundary — the one kind of code least safe to
 * duplicate. The path exists because the Phase 5 contract names it; the
 * behaviour is the existing endpoint's, unchanged.
 */
const router = Router();

router.use(authenticate);

/**
 * Role gate for the whole prefix.
 *
 * The shared `listSubmissions` handler deliberately serves students too — that
 * is how a student reads their own submission on the assignment page, and it is
 * safe because the scope filter reduces them to their own rows. But an endpoint
 * under `/api/instructor` answering a student at all is confusing, so the alias
 * refuses them here rather than quietly returning a one-row list. Applying the
 * gate to the router leaves `/api/submissions` untouched.
 */
router.use((req: Request, _res: Response, next: NextFunction) => {
  try {
    assertCanEvaluate(req.user!);
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/submissions', validate(listSubmissionsSchema), submissions.listSubmissions);
router.get(
  '/assignment/:id/progress',
  validate(gradingProgressSchema),
  submissions.gradingProgress
);

export default router;
