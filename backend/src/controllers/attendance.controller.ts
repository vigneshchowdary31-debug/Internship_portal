import { Request, Response } from 'express';
import { AttendanceService } from '../services/attendance.service';
import { asyncHandler } from '../utils/asyncHandler';

export const markAttendance = asyncHandler(async (req: Request, res: Response) => {
  const data = {
    ...req.body,
    markedBy: req.user!.id
  };
  const attendance = await AttendanceService.markAttendance(data);
  res.status(201).json({
    success: true,
    data: attendance,
  });
});

export const updateAttendance = asyncHandler(async (req: Request, res: Response) => {
  const data = {
    ...req.body,
    markedBy: req.user!.id
  };
  const attendance = await AttendanceService.updateAttendance(req.params.id, data);
  res.status(200).json({
    success: true,
    data: attendance,
  });
});

export const getSessionAttendance = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await AttendanceService.getSessionAttendance(req.params.sessionId);
  res.status(200).json({
    success: true,
    data: attendance,
  });
});

export const getStudentAttendance = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await AttendanceService.getStudentAttendance(req.params.studentId);
  res.status(200).json({
    success: true,
    data: attendance,
  });
});

export const getOverview = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await AttendanceService.getOverview();
  res.status(200).json({
    success: true,
    data: attendance,
  });
});
