import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const post = vi.fn();
vi.mock('./api', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const { attemptsApi } = await import('./quizzes');

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { data: [] } });
  post.mockResolvedValue({ data: { data: {} } });
});

describe('submit — request shape', () => {
  it('WRAPS answers in an object, matching submitAttemptSchema', async () => {
    await attemptsApi.submit('quiz1', { q1: 'Syntax', q2: 'Fn' });

    // The validator is `body: z.object({ answers: z.record(...) })`. Posting the
    // map bare would fail validation with the clock still running.
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/quizzes/quiz1/submit');
    expect(body).toEqual({ answers: { q1: 'Syntax', q2: 'Fn' } });
  });

  it('submits an empty sheet rather than omitting the field', async () => {
    await attemptsApi.submit('quiz1', {});

    // A student who answered nothing still needs the attempt closed; omitting
    // `answers` would 400 and leave it open until it expired.
    expect(post.mock.calls[0]![1]).toEqual({ answers: {} });
  });
});

describe('start', () => {
  it('posts with no body — the server resolves the attempt itself', async () => {
    post.mockResolvedValue({ data: { data: { attempt: { id: 'a1' }, resumed: true } } });

    const started = await attemptsApi.start('quiz1');

    expect(post.mock.calls[0]![0]).toBe('/quizzes/quiz1/start');
    expect(started.resumed).toBe(true);
  });
});

describe('listForQuiz', () => {
  it('reads the scoped per-quiz attempts endpoint', async () => {
    await attemptsApi.listForQuiz('quiz1');

    // NOT the quiz list's `_count.attempts`, which counts every student's
    // attempts — using that for "attempts used" would show a cohort total.
    const [url, config] = get.mock.calls[0]!;
    expect(url).toBe('/quizzes/quiz1/attempts');
    expect(config.params).not.toHaveProperty('studentId');
  });

  it('unwraps the paginated envelope to the rows', async () => {
    get.mockResolvedValue({ data: { data: [{ id: 'a1' }], meta: { total: 1 } } });
    await expect(attemptsApi.listForQuiz('quiz1')).resolves.toEqual([{ id: 'a1' }]);
  });
});

describe('get', () => {
  it('reads the standalone attempt route', async () => {
    get.mockResolvedValue({ data: { data: { id: 'a1', quizId: 'quiz1' } } });

    const attempt = await attemptsApi.get('a1');

    expect(get.mock.calls[0]![0]).toBe('/attempts/a1');
    expect(attempt.quizId).toBe('quiz1');
  });
});
