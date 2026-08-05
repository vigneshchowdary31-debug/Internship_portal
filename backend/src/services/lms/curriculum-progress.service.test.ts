import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const { CurriculumProgressService } = await import('./curriculum-progress.service');
const { contentVisibilityWhere } = await import('./visibility.service');

// Pinned for the same reason as in search.service.test.ts — an unpinned `now`
// makes the visibility-clause comparisons timing-dependent.
const NOW = new Date('2026-06-01T00:00:00.000Z');
const STUDENT = { batchId: 'b1', includeUnpublished: false, now: NOW };

/** groupBy is called twice: totals, then completed. */
function mockCounts(
  totals: { moduleId: string; n: number }[],
  completed: { moduleId: string; n: number }[]
) {
  prismaMock.content.groupBy
    .mockResolvedValueOnce(totals.map((t) => ({ moduleId: t.moduleId, _count: { _all: t.n } })))
    .mockResolvedValueOnce(completed.map((c) => ({ moduleId: c.moduleId, _count: { _all: c.n } })));
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset, not clearAllMocks: clearing resets call history but leaves any
  // unconsumed mockResolvedValueOnce values queued, which then leak into the
  // next test and make totals/completed come back from the wrong test's setup.
  prismaMock.content.groupBy.mockReset();
  prismaMock.content.groupBy.mockResolvedValue([]);
  prismaMock.contentProgress.findFirst.mockReset();
});

describe('per-module progress', () => {
  it('computes a percentage per module', async () => {
    mockCounts(
      [{ moduleId: 'm1', n: 4 }, { moduleId: 'm2', n: 10 }],
      [{ moduleId: 'm1', n: 1 }, { moduleId: 'm2', n: 5 }]
    );

    const { modules } = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);

    expect(modules).toEqual([
      { moduleId: 'm1', total: 4, completed: 1, percent: 25 },
      { moduleId: 'm2', total: 10, completed: 5, percent: 50 },
    ]);
  });

  it('reports 0% for a module with no completions', async () => {
    mockCounts([{ moduleId: 'm1', n: 3 }], []);

    const { modules } = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);
    expect(modules[0]).toMatchObject({ completed: 0, percent: 0 });
  });

  it('never divides by zero for an empty module', async () => {
    mockCounts([{ moduleId: 'm1', n: 0 }], []);

    const { modules } = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);
    expect(modules[0]!.percent).toBe(0);
    expect(Number.isNaN(modules[0]!.percent)).toBe(false);
  });

  it('returns empty totals for a path with no visible content', async () => {
    mockCounts([], []);

    const result = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);
    expect(result.modules).toEqual([]);
    expect(result.overall).toEqual({ moduleId: 'ALL', total: 0, completed: 0, percent: 0 });
  });
});

describe('overall progress is weighted, not averaged', () => {
  it('weights by item count rather than averaging module percentages', async () => {
    // m1: 1/1 = 100%, m2: 0/99 = 0%. A naive average of the two percentages
    // reports 50%, which badly overstates a student who has done 1 of 100 items.
    mockCounts(
      [{ moduleId: 'm1', n: 1 }, { moduleId: 'm2', n: 99 }],
      [{ moduleId: 'm1', n: 1 }]
    );

    const { overall } = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);

    expect(overall.total).toBe(100);
    expect(overall.completed).toBe(1);
    expect(overall.percent).toBe(1);
  });

  it('reaches 100% only when every visible item is complete', async () => {
    mockCounts(
      [{ moduleId: 'm1', n: 2 }, { moduleId: 'm2', n: 3 }],
      [{ moduleId: 'm1', n: 2 }, { moduleId: 'm2', n: 3 }]
    );

    const { overall } = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);
    expect(overall.percent).toBe(100);
  });

  it('rounds to a whole number', async () => {
    mockCounts([{ moduleId: 'm1', n: 3 }], [{ moduleId: 'm1', n: 1 }]);

    const { overall } = await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);
    expect(overall.percent).toBe(33);
  });
});

describe('the denominator is what the student can SEE', () => {
  it('applies the visibility clause to totals and completions alike', async () => {
    mockCounts([{ moduleId: 'm1', n: 1 }], [{ moduleId: 'm1', n: 1 }]);

    await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);

    const visible = contentVisibilityWhere(STUDENT);
    for (const call of prismaMock.content.groupBy.mock.calls) {
      expect(call[0].where.AND).toContainEqual(visible);
    }
  });

  it('counts completions only within the visible set, so progress cannot exceed 100%', async () => {
    mockCounts([{ moduleId: 'm1', n: 2 }], [{ moduleId: 'm1', n: 2 }]);

    await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);

    // The completed query filters on the same visibility clause AND the
    // student's own completion — not on completions alone, which would let an
    // item that later became hidden push the ratio above 1.
    const completedWhere = prismaMock.content.groupBy.mock.calls[1]![0].where;
    expect(completedWhere.AND).toContainEqual(contentVisibilityWhere(STUDENT));
    expect(completedWhere.AND).toContainEqual({
      progress: { some: { studentId: 's1', completedAt: { not: null } } },
    });
  });
});

describe('query efficiency', () => {
  it('uses two grouped queries regardless of module count', async () => {
    mockCounts(
      Array.from({ length: 40 }, (_, i) => ({ moduleId: `m${i}`, n: 5 })),
      []
    );

    await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);

    // One pair per module would be 80 queries on a page load.
    expect(prismaMock.content.groupBy).toHaveBeenCalledTimes(2);
  });

  it('skips the second query entirely when the path has no content', async () => {
    prismaMock.content.groupBy.mockResolvedValueOnce([]);

    await CurriculumProgressService.forLearningPath('s1', 'lp1', STUDENT);
    expect(prismaMock.content.groupBy).toHaveBeenCalledTimes(1);
  });
});

describe('resume point', () => {
  it('asks for the most recently viewed INCOMPLETE item in scope', async () => {
    prismaMock.contentProgress.findFirst.mockResolvedValue(null);

    await CurriculumProgressService.resumePoint('s1', STUDENT);

    const call = prismaMock.contentProgress.findFirst.mock.calls[0]![0];
    expect(call.where.completedAt).toBeNull();
    expect(call.where.content).toEqual(contentVisibilityWhere(STUDENT));
    expect(call.orderBy).toEqual({ lastViewedAt: 'desc' });
  });
});
