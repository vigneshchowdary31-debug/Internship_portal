import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import techStackRoutes from './techstack.routes';
import batchRoutes from './batch.routes';
import sessionRoutes from './session.routes';
import attendanceRoutes from './attendance.routes';
import progressRoutes from './progress.routes';
import googleRoutes from './google.routes';
import lmsRoutes from './lms.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/techstacks', techStackRoutes);
router.use('/batches', batchRoutes);
router.use('/sessions', sessionRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/progress', progressRoutes);
router.use('/google', googleRoutes);
router.use('/lms', lmsRoutes);

export default router;
