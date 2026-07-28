import { Router } from 'express';
import {
  createSession,
  getSessions,
  updateSession,
  cancelSession,
  deleteSession,
} from '../controllers/session.controller';
import { validate } from '../middlewares/validate.middleware';
import { createSessionSchema } from '../validators/session.validator';
import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Instructors and Admins can create sessions
router.post(
  '/',
  restrictTo('ADMIN', 'INSTRUCTOR'),
  validate(createSessionSchema),
  createSession
);

// All roles can view sessions (filtered by query)
router.get('/', getSessions);

// Update session (Admin or Instructor)
router.patch('/:id', restrictTo('ADMIN', 'INSTRUCTOR'), updateSession);

// Cancel session (Admin or Instructor)
router.patch('/:id/cancel', restrictTo('ADMIN', 'INSTRUCTOR'), cancelSession);

// Only admins or the instructor who created it should delete it. 
// For MVP, restricting to ADMIN and INSTRUCTOR is sufficient.
router.delete('/:id', restrictTo('ADMIN', 'INSTRUCTOR'), deleteSession);

export default router;
