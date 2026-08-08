import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../config/db', () => ({ default: prismaMock }));

const forAssignment = vi.fn();
vi.mock('../services/lms/analytics.service', () => ({
  AnalyticsService: { forAssignment: (...a: unknown[]) => forAssignment(...a) },
}));

const { assignmentAnalytics } = await import('./analytics.controller');

/**
 * Regression tests for the analytics scoping fix.
 *
 * The defect lived in the CONTROLLER, not the service: `forAssignment` has
 * accepted a scope since Phase 5, and this call site simply never passed one.
 * So these tests assert the argument the controller hands over — a service-level
 * test cannot see a scope that was never supplied.
 *
 * The policy layer is deliberately NOT mocked. `studentWorkScopeFor` is the
 * thing under test as much as the controller is: the point is that role → scope
 * is decided in one place, so exercising the real function is what proves the
 * two screens now agree.
 */

/**
 * Minimal express doubles — enough for an asyncHandler-wrapped controller.
 *
 * `asyncHandler` returns undefined and swallows the inner promise
 * (`Promise.resolve(fn(...)).catch(next)`), so awaiting the call itself proves
 * nothing. The `setTimeout(0)` drains the microtask queue, which is enough here
 * because every dependency is a mock that resolves immediately.
 */
async function invoke(
  user: { id: string; role: string },
  params: Record<string, string> = { id: 'a1' }
) {
  const req = { user, params, query: {} } as any;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) } as any;
  const next = vi.fn();

  assignmentAnalytics(req, res, next);
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { json, next };
}

const STATS = {
  totalSubmissions: 12,
  gradedSubmissions: 9,
  averageMarks: 76.4,
  highestMarks: 98,
  lowestMarks: 41,
  lateCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  forAssignment.mockResolvedValue(STATS);
  prismaMock.assignment.findUnique.mockResolvedValue({ learningPathId: 'lp1' });
  prismaMock.batch.findMany.mockResolvedValue([{ id: 'b1' }]);
  prismaMock.instructorBatch.findMany.mockResolvedValue([{ batchId: 'b1' }]);
});

describe('assignmentAnalytics — admin', () => {
  it('passes an EMPTY scope, so an admin still sees the whole cohort', async () => {
    await invoke({ id: 'admin1', role: 'ADMIN' });

    // {} adds no restriction to the aggregate. The admin view is unchanged by
    // this fix, which is the point of routing both roles through one function.
    expect(forAssignment).toHaveBeenCalledWith('a1', {});
  });

  it('does not consult instructor batch membership at all', async () => {
    await invoke({ id: 'admin1', role: 'ADMIN' });

    expect(prismaMock.instructorBatch.findMany).not.toHaveBeenCalled();
  });

  it('returns the service result unchanged', async () => {
    const {json} = await invoke({ id: 'admin1', role: 'ADMIN' });

    expect(json).toHaveBeenCalledWith({ success: true, data: STATS });
  });
});

describe('assignmentAnalytics — instructor', () => {
  it('passes a scope restricted to the batches they teach', async () => {
    prismaMock.instructorBatch.findMany.mockResolvedValue([
      { batchId: 'b1' },
      { batchId: 'b2' },
    ]);

    await invoke({ id: 'inst1', role: 'INSTRUCTOR' });

    // This is the fix. Before it, the second argument was absent and the
    // aggregate ran over every cohort on the curriculum.
    expect(forAssignment).toHaveBeenCalledWith('a1', {
      student: { studentBatches: { some: { batchId: { in: ['b1', 'b2'] } } } },
    });
  });

  it('never passes an absent or empty scope for an instructor', async () => {
    await invoke({ id: 'inst1', role: 'INSTRUCTOR' });

    const scope = forAssignment.mock.calls[0]![1];

    // Both failure modes, stated separately. `toBeDefined` is the one that
    // matters: the original bug passed NO second argument at all, and
    // `expect(undefined).not.toEqual({})` is satisfied by that — a guard that
    // would have watched the leak go by.
    expect(scope).toBeDefined();
    expect(scope).not.toEqual({});
  });

  it('scopes to nothing when they are assigned to no batches', async () => {
    prismaMock.instructorBatch.findMany.mockResolvedValue([]);
    // Still passes the curriculum check so we reach the scope line.
    prismaMock.batch.findMany.mockResolvedValue([{ id: 'b1' }]);

    await invoke({ id: 'inst1', role: 'INSTRUCTOR' });

    // An empty IN list matches no rows — the honest answer, and emphatically
    // not "no filter".
    expect(forAssignment).toHaveBeenCalledWith('a1', {
      student: { studentBatches: { some: { batchId: { in: [] } } } },
    });
  });

  it('refuses an assignment outside the curriculum they teach', async () => {
    prismaMock.batch.findMany.mockResolvedValue([]);

    const {next} = await invoke({ id: 'inst1', role: 'INSTRUCTOR' });

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0]![0].message).toMatch(/not part of a curriculum you teach/);
    expect(forAssignment).not.toHaveBeenCalled();
  });

  it('404s an unknown assignment before computing anything', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const {next} = await invoke({ id: 'inst1', role: 'INSTRUCTOR' });

    expect(next.mock.calls[0]![0].message).toBe('Assignment not found');
    expect(forAssignment).not.toHaveBeenCalled();
  });
});

describe('assignmentAnalytics — students are refused outright', () => {
  it('rejects a STUDENT before any query runs', async () => {
    const {next} = await invoke({ id: 's1', role: 'STUDENT' });

    // A class average is other people's performance in aggregate — a different
    // question from a student seeing their own standing.
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0]![0].statusCode).toBe(403);
    expect(forAssignment).not.toHaveBeenCalled();
  });
});

describe('the two screens now agree', () => {
  it('hands the grading endpoint and the analytics endpoint the same scope', async () => {
    prismaMock.instructorBatch.findMany.mockResolvedValue([{ batchId: 'b1' }]);

    await invoke({ id: 'inst1', role: 'INSTRUCTOR' });

    // GET /instructor/assignment/:id/progress builds its scope from the very
    // same `studentWorkScopeFor`. Identical scope over identical aggregates is
    // what makes "9 of 12 marked" match between the two screens; a divergence
    // here is the bug returning.
    const { studentWorkScopeFor } = await import('../policies/lms.policy');
    const gradingScope = await studentWorkScopeFor({ id: 'inst1', role: 'INSTRUCTOR' } as any);

    expect(forAssignment.mock.calls[0]![1]).toEqual(gradingScope);
  });
});
