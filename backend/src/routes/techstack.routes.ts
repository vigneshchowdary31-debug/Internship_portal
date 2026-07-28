import { Request, Response, Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import prisma from '../config/db';
import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Get all tech stacks
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const techStacks = await prisma.techStack.findMany({ orderBy: { name: 'asc' } });
  res.status(200).json({ success: true, data: techStacks });
}));

// Create a tech stack (Admin only)
router.post('/', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

  const techStack = await prisma.techStack.create({ data: { name } });
  res.status(201).json({ success: true, data: techStack });
}));

// Edit a tech stack (Admin only)
router.patch('/:id', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

  const techStack = await prisma.techStack.update({
    where: { id },
    data: { name },
  });
  res.status(200).json({ success: true, data: techStack });
}));

// Delete a tech stack (Admin only)
router.delete('/:id', restrictTo('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    await prisma.techStack.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Tech stack deleted successfully' });
  } catch (error: any) {
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete Tech Stack because it is used in active batches.' 
      });
    }
    throw error;
  }
}));

export default router;
