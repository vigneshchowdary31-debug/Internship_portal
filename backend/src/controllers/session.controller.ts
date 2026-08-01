import { Request, Response } from 'express';
import { SessionService } from '../services/session.service';
import { asyncHandler } from '../utils/asyncHandler';
import prisma from '../config/db';

export const createSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await SessionService.createSession(req.body);
  res.status(201).json({
    success: true,
    data: session,
  });
});

export const getSessions = asyncHandler(async (req: Request, res: Response) => {
  const filters: any = {};
  
  if (req.user!.role === 'INSTRUCTOR') {
    filters.instructorId = req.user!.id;
  } else if (req.user!.role === 'STUDENT') {
    const studentBatches = await prisma.studentBatch.findMany({ where: { studentId: req.user!.id } });
    filters.batchId = { in: studentBatches.map(sb => sb.batchId) };
  } else {
    // Admin can filter by query params
    if (req.query.batchId) filters.batchId = req.query.batchId as string;
    if (req.query.instructorId) filters.instructorId = req.query.instructorId as string;
  }

  const sessions = await SessionService.getSessions(filters);
  res.status(200).json({
    success: true,
    data: sessions,
  });
});

export const updateSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await SessionService.updateSession(req.params.id, req.body);
  res.status(200).json({
    success: true,
    data: session,
  });
});

export const cancelSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await SessionService.cancelSession(req.params.id);
  res.status(200).json({
    success: true,
    data: session,
    message: 'Session cancelled successfully',
  });
});

export const deleteSession = asyncHandler(async (req: Request, res: Response) => {
  await SessionService.deleteSession(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Session deleted successfully',
  });
});
