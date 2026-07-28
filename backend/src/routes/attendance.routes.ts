import { Router } from 'express';
import {
  markAttendance,
  updateAttendance,
  getSessionAttendance,
  getStudentAttendance,
  getOverview
} from '../controllers/attendance.controller';
import { validate } from '../middlewares/validate.middleware';
import { markAttendanceSchema, updateAttendanceSchema } from '../validators/attendance.validator';
import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Everyone can view student attendance (Student can view their own, Admin/Inst can view any)
router.get('/student/:studentId', getStudentAttendance);

// Only Admin and Instructor can mark/update attendance and view session attendance/overviews
router.use(restrictTo('ADMIN', 'INSTRUCTOR'));

router.get('/overview', getOverview);
router.get('/session/:sessionId', getSessionAttendance);
router.post('/', validate(markAttendanceSchema), markAttendance);
router.patch('/:id', validate(updateAttendanceSchema), updateAttendance);

export default router;
