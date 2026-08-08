import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logger } = await import('./logger');

/**
 * Logs are shipped to third-party platforms and retained for months, so what
 * they must NOT contain matters as much as what they do.
 */

let out: { level: string; args: unknown[] }[] = [];

beforeEach(() => {
  out = [];
  vi.stubEnv('LOG_LEVEL', 'debug');
  vi.spyOn(console, 'log').mockImplementation((...args) => out.push({ level: 'log', args }));
  vi.spyOn(console, 'warn').mockImplementation((...args) => out.push({ level: 'warn', args }));
  vi.spyOn(console, 'error').mockImplementation((...args) => out.push({ level: 'error', args }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const line = () => String(out[0]?.args[0] ?? '');

describe('structured output', () => {
  it('emits one JSON object per line in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    logger.info('Bulk grading completed', { requestId: 'r1', userId: 'u1', count: 12 });

    // One object per line is what every log platform ingests without a parser.
    const parsed = JSON.parse(line());
    expect(parsed).toMatchObject({
      level: 'info',
      msg: 'Bulk grading completed',
      requestId: 'r1',
      userId: 'u1',
      count: 12,
    });
    expect(parsed.time).toBeTruthy();
  });

  it('emits something readable in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    logger.info('Submission graded', { submissionId: 'sub1' });

    expect(line()).toContain('[info] Submission graded');
    expect(line()).toContain('submissionId=sub1');
  });

  it('routes errors to console.error and warnings to console.warn', () => {
    vi.stubEnv('NODE_ENV', 'development');

    logger.error('boom');
    logger.warn('careful');

    // Platforms split streams on this; putting everything on stdout loses the
    // distinction that makes an alert rule possible.
    expect(out[0].level).toBe('error');
    expect(out[1].level).toBe('warn');
  });
});

describe('what must never appear in a log line', () => {
  it('redacts sensitive keys whatever the call site passes', () => {
    vi.stubEnv('NODE_ENV', 'production');

    logger.info('Auth attempt', {
      userId: 'u1',
      password: 'hunter2',
      token: 'eyJhbGciOi',
      refreshToken: 'secret-refresh',
    });

    const parsed = JSON.parse(line());
    expect(parsed.password).toBe('[redacted]');
    expect(parsed.token).toBe('[redacted]');
    expect(parsed.refreshToken).toBe('[redacted]');
    expect(line()).not.toContain('hunter2');
    expect(line()).not.toContain('eyJhbGciOi');
  });

  it('omits undefined rather than logging null', () => {
    vi.stubEnv('NODE_ENV', 'production');

    logger.info('Graded', { userId: 'u1', assignmentId: undefined });

    expect(JSON.parse(line())).not.toHaveProperty('assignmentId');
  });
});

describe('level filtering', () => {
  it('is silent under test by default, so specs do not print', () => {
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('NODE_ENV', 'test');

    logger.info('should not appear');
    logger.error('nor this');

    expect(out).toHaveLength(0);
  });

  it('honours an explicit LOG_LEVEL', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOG_LEVEL', 'warn');

    logger.info('dropped');
    logger.warn('kept');

    expect(out).toHaveLength(1);
    expect(line()).toContain('kept');
  });
});

describe('child loggers', () => {
  it('binds context onto every line', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const bound = logger.child({ requestId: 'r1', userId: 'u1' });

    bound.info('Graded', { submissionId: 'sub1' });

    expect(JSON.parse(line())).toMatchObject({
      requestId: 'r1',
      userId: 'u1',
      submissionId: 'sub1',
    });
  });

  it('evaluates getters at LOG time, not at bind time', () => {
    vi.stubEnv('NODE_ENV', 'production');

    // How the request middleware picks up a userId that `authenticate` sets
    // after the logger was already bound.
    let currentUser: string | undefined;
    const bound = logger.child({
      get userId() {
        return currentUser;
      },
    });

    currentUser = 'u-after-auth';
    bound.info('Graded');

    expect(JSON.parse(line()).userId).toBe('u-after-auth');
  });

  it('lets a per-call field override the bound one', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const bound = logger.child({ userId: 'u1' });

    bound.info('Acting for another user', { userId: 'u2' });

    expect(JSON.parse(line()).userId).toBe('u2');
  });
});
