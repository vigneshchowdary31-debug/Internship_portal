import { Request, Response, Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import prisma from '../config/db';
import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Get all batches with their tech stacks
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  let whereClause = {};

  // For students or instructors, we should filter, but for MVP we might just fetch what's needed.
  if (req.user.role === 'INSTRUCTOR') {
    whereClause = { instructorBatches: { some: { instructorId: req.user.id } } };
  } else if (req.user.role === 'STUDENT') {
    whereClause = { studentBatches: { some: { studentId: req.user.id } } };
  }

  const batches = await prisma.batch.findMany({
    where: whereClause,
    include: {
      techStack: true,
      instructorBatches: { include: { instructor: { select: { id: true, name: true } } } },
      studentBatches: { include: { student: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  res.status(200).json({ success: true, data: batches });
}));

// Get a single batch by ID
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      techStack: true,
      instructorBatches: { include: { instructor: { select: { id: true, name: true, email: true } } } },
      studentBatches: { include: { student: { select: { id: true, name: true, email: true } } } },
    },
  });

  if (!batch) {
    return res.status(404).json({ success: false, message: 'Batch not found' });
  }

  // Optional: check if instructor has access, but for MVP returning it is fine since auth middleware protects it
  res.status(200).json({ success: true, data: batch });
}));

// Create a batch (Admin only)
router.post('/', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { name, techStackId } = req.body;
  if (!name || !techStackId) {
    return res.status(400).json({ success: false, message: 'Name and TechStackId are required' });
  }

  const batch = await prisma.batch.create({
    data: { name, techStackId },
  });

  res.status(201).json({ success: true, data: batch });
}));

// Assign Students to a Batch (Overwrite)
router.post('/:id/students', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { studentIds } = req.body; // array of student ids
  const batchId = req.params.id;

  const data = studentIds.map((studentId: string) => ({ studentId, batchId }));

  await prisma.$transaction([
    prisma.studentBatch.deleteMany({ where: { batchId } }),
    prisma.studentBatch.createMany({ data, skipDuplicates: true }),
  ]);

  res.status(200).json({ success: true, message: 'Students assigned successfully' });
}));

// Assign Instructors to a Batch (Overwrite)
router.post('/:id/instructors', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { instructorIds } = req.body; // array of instructor ids
  const batchId = req.params.id;

  const data = instructorIds.map((instructorId: string) => ({ instructorId, batchId }));

  await prisma.$transaction([
    prisma.instructorBatch.deleteMany({ where: { batchId } }),
    prisma.instructorBatch.createMany({ data, skipDuplicates: true }),
  ]);

  res.status(200).json({ success: true, message: 'Instructors assigned successfully' });
}));

// Edit a batch (Admin only)
router.patch('/:id', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, techStackId } = req.body;
  if (!name || !techStackId) return res.status(400).json({ success: false, message: 'Name and TechStackId are required' });

  const batch = await prisma.batch.update({
    where: { id },
    data: { name, techStackId },
  });
  res.status(200).json({ success: true, data: batch });
}));

// Delete a batch (Admin only)
router.delete('/:id', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    await prisma.batch.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Batch deleted successfully' });
  } catch (error: any) {
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete Batch because it is used in active sessions.' 
      });
    }
    throw error;
  }
}));

export default router;
