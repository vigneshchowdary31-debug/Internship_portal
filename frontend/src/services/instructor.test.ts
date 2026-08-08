import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const patch = vi.fn();
vi.mock('./api', () => ({
  default: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) },
}));

const { instructorApi } = await import('./instructor');

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { data: [] } });
  patch.mockResolvedValue({ data: { data: {} } });
});

describe('progress', () => {
  it('reads the batch-scoped grading endpoint, not analytics', async () => {
    await instructorApi.progress('a1');

    // /analytics/assignment/:id is NOT narrowed to the instructor's batches, so
    // it would report counts including cohorts this screen cannot show.
    expect(get.mock.calls[0]![0]).toBe('/instructor/assignment/a1/progress');
  });
});

describe('listSubmissions', () => {
  it('filters by assignment and never by student', async () => {
    await instructorApi.listSubmissions('a1');

    // Which students an instructor may see is the server's decision; sending a
    // studentId would be the client asserting an authorization outcome.
    const [url, config] = get.mock.calls[0]!;
    expect(url).toBe('/instructor/submissions');
    expect(config.params).toEqual({ assignmentId: 'a1', pageSize: 100 });
  });

  it('unwraps the paginated envelope to the rows', async () => {
    get.mockResolvedValue({ data: { data: [{ id: 'sub1' }], meta: { total: 1 } } });
    await expect(instructorApi.listSubmissions('a1')).resolves.toEqual([{ id: 'sub1' }]);
  });
});

describe('bulkGrade — request shape', () => {
  const items = [
    { submissionId: 's1', marks: 80, feedback: 'Good' },
    { submissionId: 's2', marks: 65, feedback: null },
  ];

  it('sends a BARE ARRAY, not an object wrapping one', async () => {
    await instructorApi.bulkGrade(items);

    // The validator is `z.object({ body: z.array(...) })`. Wrapping it as
    // `{ grades: [...] }` or `{ items: [...] }` fails validation outright.
    const [url, body] = patch.mock.calls[0]!;
    expect(url).toBe('/submissions/bulk-grade');
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(items);
  });

  it('targets the bulk route, not the single-grade one', async () => {
    await instructorApi.bulkGrade(items);

    // `/submissions/:id/grade` with an array body would 400 on the uuid param.
    expect(patch.mock.calls[0]![0]).not.toMatch(/\/grade$/);
  });
});

describe('gradeOne', () => {
  it('patches the single-grade route with marks and feedback', async () => {
    await instructorApi.gradeOne('sub1', { marks: 90, feedback: 'Excellent' });

    const [url, body] = patch.mock.calls[0]!;
    expect(url).toBe('/submissions/sub1/grade');
    expect(body).toEqual({ marks: 90, feedback: 'Excellent' });
  });
});
