import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * The single error responder.
 *
 * ── RESPONSE SHAPE, AND WHY IT CARRIES BOTH ─────────────────────────────────
 * Phase 7 standardises on:
 *
 *     { success: false, error: { message, code }, requestId }
 *
 * but every response ALSO keeps the flat `message` (and `errors`) the previous
 * shape used. That is deliberate: the shipped frontend reads
 * `response.data.message` in `errorMessage()`, and a dozen call sites render it
 * in toasts. Emitting only the new shape would turn every error message in the
 * product into "Something went wrong" — a regression far worse than the
 * inconsistency being fixed.
 *
 * Both shapes are populated from the same values, so they cannot disagree. Once
 * the frontend reads `error.message`, the flat fields can be dropped in one
 * commit with nothing else to change.
 */

/** Stable, machine-readable codes. Clients branch on these, never on prose. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** HTTP status → code, for AppErrors that do not name one themselves. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return ERROR_CODES.UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    case 413:
      return ERROR_CODES.PAYLOAD_TOO_LARGE;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
  }
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = req.requestId;

  /** Builds the dual-shape body. `extra` carries shape-specific fields. */
  const respond = (
    status: number,
    code: ErrorCode,
    message: string,
    extra: Record<string, unknown> = {}
  ) => {
    return res.status(status).json({
      success: false,
      // --- Phase 7 shape ---
      error: { message, code },
      requestId,
      // --- Retained for the shipped frontend. Same values, one source. ---
      message,
      ...extra,
    });
  };

  // --- Validation -----------------------------------------------------------
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));

    logger.warn('Validation failed', {
      requestId,
      userId: req.user?.id,
      path: req.originalUrl,
      fields: errors.map((e) => e.field),
    });

    return respond(400, ERROR_CODES.VALIDATION_FAILED, 'Validation failed', { errors });
  }

  // --- Known application errors --------------------------------------------
  if (err instanceof AppError) {
    // Expected outcomes (a 404, a 403, a refused delete) are not incidents.
    // Logging them at error level trains people to ignore the error stream.
    logger[err.statusCode >= 500 ? 'error' : 'info']('Handled application error', {
      requestId,
      userId: req.user?.id,
      path: req.originalUrl,
      status: err.statusCode,
      message: err.message,
    });

    return respond(err.statusCode, codeForStatus(err.statusCode), err.message);
  }

  // --- Body parser ----------------------------------------------------------
  if (err?.type === 'entity.too.large') {
    logger.warn('Payload rejected as too large', {
      requestId,
      userId: req.user?.id,
      path: req.originalUrl,
      limit: err.limit,
    });

    return respond(
      413,
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      'That request is too large. Send fewer items at a time.'
    );
  }

  // --- Prisma ---------------------------------------------------------------
  if (err?.name === 'PrismaClientValidationError' || err?.name === 'PrismaClientKnownRequestError') {
    const isValidation = err.name === 'PrismaClientValidationError';

    logger.error('Database error', {
      requestId,
      userId: req.user?.id,
      path: req.originalUrl,
      prismaCode: err.code,
      error: err.message,
    });

    return respond(
      400,
      ERROR_CODES.DATABASE_ERROR,
      isValidation ? 'Database validation failed' : 'Database query failed',
      {
        // The raw Prisma message names columns and constraints — useful in
        // development, an internals leak in production.
        details: process.env.NODE_ENV === 'production'
          ? isValidation ? 'Invalid query payload' : 'Query constraint violation'
          : err.message,
      }
    );
  }

  // --- Anything else --------------------------------------------------------
  logger.error('Unhandled error', {
    requestId,
    userId: req.user?.id,
    path: req.originalUrl,
    method: req.method,
    error: err?.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  });

  return respond(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err?.message || 'Internal Server Error'
  );
};
