import { Request, Response } from 'express';
import { ProgressService } from '../services/progress.service';
import { asyncHandler } from '../utils/asyncHandler';

export const updateProgress = asyncHandler(async (req: Request, res: Response) => {
  const progress = await ProgressService.updateProgress(req.body);
  res.status(200).json({
    success: true,
    data: progress,
  });
});

export const getStudentProgress = asyncHandler(async (req: Request, res: Response) => {
  const progress = await ProgressService.getStudentProgress(req.params.studentId);
  res.status(200).json({
    success: true,
    data: progress,
  });
});

export const getOverview = asyncHandler(async (req: Request, res: Response) => {
  const progress = await ProgressService.getOverview();
  res.status(200).json({
    success: true,
    data: progress,
  });
});
