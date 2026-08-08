import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZodError, z } from 'zod';
import { AppError } from '../utils/AppError';
import { errorHandler, ERROR_CODES } from './error.middleware';

/**
 * The error contract, pinned.
 *
 * The single most important assertion here is that EVERY response carries the
 * flat `message` as well as the new `error.message`. The shipped frontend reads
 * `response.data.message` in `errorMessage()`; emitting only the new shape
 * would turn every error in the product into "Something went wrong" — a worse
 * regression than the inconsistency Phase 7 set out to fix.
 */

function handle(err: unknown, req: Record<string, unknown> = {}) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const request = { requestId: 'req-1', originalUrl: '/api/test', method: 'GET', ...req } as any;

  errorHandler(err, request, { status } as any, vi.fn());

  return { status, body: json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('every error carries BOTH shapes', () => {
  it.each([
    ['AppError 404', new AppError('Assignment not found', 404)],
    ['AppError 409', new AppError('Already marked', 409)],
    ['unknown error', new Error('kaboom')],
  ])('%s populates error.message and the flat message identically', (_label, err) => {
    const { body } = handle(err);

    expect(body.error.message).toBeTruthy();
    expect(body.message).toBe(body.error.message);
    expect(body.success).toBe(false);
  });

  it('includes the requestId so a log line can be found from a ticket', () => {
    const { body } = handle(new AppError('nope', 404));
    expect(body.requestId).toBe('req-1');
  });
});

describe('status and code', () => {
  it.each([
    [400, ERROR_CODES.VALIDATION_FAILED],
    [401, ERROR_CODES.UNAUTHORIZED],
    [403, ERROR_CODES.FORBIDDEN],
    [404, ERROR_CODES.NOT_FOUND],
    [409, ERROR_CODES.CONFLICT],
  ])('maps status %i to %s', (statusCode, expected) => {
    const { status, body } = handle(new AppError('x', statusCode));

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(body.error.code).toBe(expected);
  });

  it('answers 500 INTERNAL_ERROR for anything unrecognised', () => {
    const { status, body } = handle(new Error('kaboom'));

    expect(status).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});

describe('validation errors keep their field detail', () => {
  it('reports every failing field', () => {
    const schema = z.object({ marks: z.number(), feedback: z.string() });
    const parsed = schema.safeParse({ marks: 'x' });
    const err = (parsed as { error: ZodError }).error;

    const { status, body } = handle(err);

    expect(status).toHaveBeenCalledWith(400);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // The frontend joins these; dropping them loses the per-field reason.
    expect(body.errors.map((e: { field: string }) => e.field)).toEqual(['marks', 'feedback']);
  });
});

describe('payload size', () => {
  it('turns a body-parser rejection into an explained 413', () => {
    const { status, body } = handle({ type: 'entity.too.large', limit: 10240 });

    // Otherwise a bulk-grade batch that is one item too large fails as a bare
    // 413 with no indication of what to do about it.
    expect(status).toHaveBeenCalledWith(413);
    expect(body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(body.message).toMatch(/fewer items/);
  });
});

describe('production hides internals', () => {
  it('does not leak an unexpected error message', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const { body } = handle(new Error('column "secret_col" does not exist'));

    expect(body.message).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toContain('secret_col');
  });

  it('still reveals it outside production, where it is the useful part', () => {
    vi.stubEnv('NODE_ENV', 'development');

    const { body } = handle(new Error('column "secret_col" does not exist'));
    expect(body.message).toContain('secret_col');
  });

  it('masks Prisma detail in production but keeps the 400', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const err = Object.assign(new Error('Invalid `prisma.user.findMany()` invocation'), {
      name: 'PrismaClientValidationError',
    });
    const { status, body } = handle(err);

    expect(status).toHaveBeenCalledWith(400);
    expect(body.error.code).toBe(ERROR_CODES.DATABASE_ERROR);
    expect(body.details).toBe('Invalid query payload');
  });
});
