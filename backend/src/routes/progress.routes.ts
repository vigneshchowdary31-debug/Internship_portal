import { Router } from 'express';
import {
  updateProgress,
  getStudentProgress,
  getOverview
} from '../controllers/progress.controller';
import { validate } from '../middlewares/validate.middleware';
import { updateProgressSchema } from '../validators/progress.validator';
import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Everyone can view student progress
router.get('/student/:studentId', getStudentProgress);

// Only Admin and Instructor can update progress and view overviews
router.use(restrictTo('ADMIN', 'INSTRUCTOR'));

router.get('/overview', getOverview);
router.post('/', validate(updateProgressSchema), updateProgress);
// we can use POST as an upsert endpoint for simplicity. Or PATCH. 
router.patch('/', validate(updateProgressSchema), updateProgress);

export default router;
