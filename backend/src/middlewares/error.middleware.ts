import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err);

  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // Handle Prisma validation errors
  if (err.name === 'PrismaClientValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Database validation failed',
      details: err.message,
    });
  }

  // Log unhandled errors
  console.error('\n--- UNHANDLED ERROR ---');
  console.error(`[${req.method}] ${req.originalUrl}`);
  console.error('Payload:', req.body);
  console.error(err);
  console.error('-----------------------\n');

  return res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};
