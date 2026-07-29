import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error(`\n--- ERROR [${req.method}] ${req.originalUrl} ---`);
    console.error(err);
    console.error('-------------------------------------------\n');
  }

  // Zod Validation Errors
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

  // Known Application Errors
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
      details: process.env.NODE_ENV === 'production' ? 'Invalid query payload' : err.message,
    });
  }
  
  if (err.name === 'PrismaClientKnownRequestError') {
    return res.status(400).json({
      success: false,
      message: 'Database query failed',
      details: process.env.NODE_ENV === 'production' ? 'Query constraint violation' : err.message,
    });
  }

  // Unhandled / Unknown Errors
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : (err.message || 'Internal Server Error');

  return res.status(500).json({
    success: false,
    message,
  });
};
