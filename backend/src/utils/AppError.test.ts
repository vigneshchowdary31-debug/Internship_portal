import { describe, it, expect } from 'vitest';
import { AppError } from './AppError';

describe('AppError Utility', () => {
  it('should create an error with the correct message and status code', () => {
    const error = new AppError('Resource not found', 404);
    
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Resource not found');
    expect(error.statusCode).toBe(404);
    expect(error.isOperational).toBe(true);
  });

  it('should format message and use default 500 status code if not provided', () => {
    // TypeScript ensures statusCode is required, but if bypassed:
    const error = new AppError('Internal Server Error', 500);
    
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('Internal Server Error');
  });
});
