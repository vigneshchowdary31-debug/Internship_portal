import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as analytics from '../controllers/analytics.controller';
import {
  studentAnalyticsSchema,
  courseAnalyticsSchema,
  assignmentAnalyticsSchema,
  atRiskSchema,
} from '../validators/analytics.validator';

/**
 * Analytics routes — Phase 4. Mounted at /api/analytics.
 *
 * `/student` is the only endpoint a STUDENT may call, and only for themselves.
 * Everything else is cohort-level — other people's performance in aggregate —
 * and is gated by `assertCanEvaluate` in the controller.
 *
 * Static paths are declared before parameterised ones so `/at-risk` and
 * `/overview` are never captured by a `/:id` route.
 */
const router = Router();

router.use(authenticate);

router.get('/student', validate(studentAnalyticsSchema), analytics.studentAnalytics);
router.get('/at-risk', validate(atRiskSchema), analytics.atRiskStudents);
router.get('/overview', analytics.overviewAnalytics);

router.get('/course/:learningPathId', validate(courseAnalyticsSchema), analytics.courseAnalytics);
router.get('/assignment/:id', validate(assignmentAnalyticsSchema), analytics.assignmentAnalytics);

export default router;
