import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const { AnalyticsService } = await import('./analytics.service');

const asStudent = { batchId: 'b1', includeUnpublished: false };
const asAdmin = { batchId: null, includeUnpublished: true };

/** groupBy row for the score aggregate: avg + how many rows carried a mark. */
const scoreGroup = (assignmentId: string, avg: number | null, count: number) => ({
  assignmentId,
  _avg: { marks: avg },
  _count: { marks: count },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignment.findMany.mockResolvedValue([]);
  prismaMock.assignment.findUnique.mockResolvedValue({ id: 'a1' });
  prismaMock.submission.count.mockResolvedValue(0);
  prismaMock.submission.groupBy.mockResolvedValue([]);
  prismaMock.submission.aggregate.mockResolvedValue({
    _count: { _all: 0, marks: 0 },
    _avg: { marks: null },
    _max: { marks: null },
    _min: { marks: null },
  });
  prismaMock.studentBatch.groupBy.mockResolvedValue([]);
  prismaMock.batch.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

// --- 1. Student -------------------------------------------------------------

describe('forStudent', () => {
  const ASSIGNMENTS = [
    { id: 'a1', title: 'API', maxMarks: 100 },
    { id: 'a2', title: 'Quiz prep', maxMarks: 10 },
    { id: 'a3', title: 'Essay', maxMarks: 50 },
  ];

  beforeEach(() => {
    prismaMock.assignment.findMany.mockResolvedValue(ASSIGNMENTS);
  });

  it('derives progress from submissions against visible assignments', async () => {
    prismaMock.submission.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    expect(result.totalAssignments).toBe(3);
    expect(result.completedAssignments).toBe(2);
    expect(result.pendingAssignments).toBe(1);
    expect(result.progressPercentage).toBe(67);
  });

  it('AND-s the denominator with the shared visibility clause', async () => {
    await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    // Counting every assignment on the curriculum — including drafts and
    // another batch's — would put 100% permanently out of reach.
    const where = prismaMock.assignment.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ learningPathId: { in: ['lp1'] } });
    expect(where.AND[1]).toEqual({
      AND: [
        { isPublished: true, module: { isVisible: true } },
        { OR: [{ scope: 'LEARNING_PATH' }, { scope: 'BATCH', batchId: 'b1' }] },
      ],
    });
  });

  it('scopes every aggregate to this student and these assignments', async () => {
    await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    expect(prismaMock.submission.count.mock.calls[0]![0].where).toEqual({
      studentId: 's1',
      assignmentId: { in: ['a1', 'a2', 'a3'] },
    });
  });

  it('counts late submissions separately', async () => {
    prismaMock.submission.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    expect(result.lateSubmissions).toBe(2);
    expect(prismaMock.submission.count.mock.calls[1]![0].where.isLate).toBe(true);
  });

  it('averages score as a PERCENTAGE of each assignment’s own maximum', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      scoreGroup('a1', 80, 1), // 80/100 = 80%
      scoreGroup('a2', 5, 1), //   5/10  = 50%
    ]);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    // Raw averaging would give (80+5)/2 = 42.5, which says nothing: the 10-mark
    // exercise and the 100-mark project are not comparable totals.
    expect(result.averageScore).toBe(65);
  });

  it('weights the average by how many marks each group holds', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      scoreGroup('a1', 90, 3), // three at 90/100
      scoreGroup('a2', 5, 1), //  one at 5/10
    ]);

    // (0.9*3 + 0.5*1) / 4 = 0.8
    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);
    expect(result.averageScore).toBe(80);
  });

  it('only counts marked work in the average, never ungraded', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([]);
    prismaMock.submission.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    // Three submissions, none marked: 0, not 0-out-of-3 dragging an average.
    expect(result.averageScore).toBe(0);
    expect(prismaMock.submission.groupBy.mock.calls[0]![0].where.marks).toEqual({ not: null });
  });

  it('ignores a group whose average is null', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      scoreGroup('a1', null, 0),
      scoreGroup('a2', 5, 1),
    ]);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);
    expect(result.averageScore).toBe(50);
  });

  it('ignores a group for an assignment that is not in the visible set', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([scoreGroup('gone', 100, 1)]);

    // No maxMarks for it, so it cannot be turned into a percentage. Counting it
    // as full marks would reward work on a withdrawn assignment.
    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);
    expect(result.averageScore).toBe(0);
  });
});

describe('forStudent — empty states return 0, never null or NaN', () => {
  it('returns all zeros when the curriculum has no assignments', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);

    expect(result).toEqual({
      totalAssignments: 0,
      completedAssignments: 0,
      pendingAssignments: 0,
      lateSubmissions: 0,
      averageScore: 0,
      progressPercentage: 0,
    });
  });

  it('returns all zeros for a student with no learning path', async () => {
    const result = await AnalyticsService.forStudent('s1', [], asStudent);

    expect(result.progressPercentage).toBe(0);
    // No path means no query at all — not a query with an empty IN list.
    expect(prismaMock.assignment.findMany).not.toHaveBeenCalled();
  });

  it('never reports negative pending work', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([{ id: 'a1', title: 'X', maxMarks: 10 }]);
    // More submissions than assignments should be impossible, but a stale
    // denominator must not surface as "-2 pending".
    prismaMock.submission.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const result = await AnalyticsService.forStudent('s1', ['lp1'], asStudent);
    expect(result.pendingAssignments).toBe(0);
  });
});

// --- 2. Course --------------------------------------------------------------

describe('forCourse', () => {
  const ASSIGNMENTS = [
    { id: 'a1', title: 'API', maxMarks: 100, scope: 'LEARNING_PATH', batchId: null },
    { id: 'a2', title: 'Essay', maxMarks: 50, scope: 'LEARNING_PATH', batchId: null },
  ];

  beforeEach(() => {
    prismaMock.assignment.findMany.mockResolvedValue(ASSIGNMENTS);
    prismaMock.studentBatch.groupBy.mockResolvedValue([
      { batchId: 'b1', _count: { _all: 8 } },
      { batchId: 'b2', _count: { _all: 2 } },
    ]);
  });

  it('sums students across the batches in scope', async () => {
    const result = await AnalyticsService.forCourse('lp1', ['b1', 'b2'], asAdmin);
    expect(result.totalStudents).toBe(10);
  });

  it('computes completion against students × assignments', async () => {
    prismaMock.submission.count.mockResolvedValueOnce(10).mockResolvedValueOnce(0);

    // 10 submissions of an expected 10 students × 2 assignments = 50%.
    const result = await AnalyticsService.forCourse('lp1', ['b1', 'b2'], asAdmin);
    expect(result.assignmentCompletionRate).toBe(50);
  });

  it('expects batch-scoped work only of its own batch', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      ASSIGNMENTS[0],
      { id: 'a3', title: 'Extra', maxMarks: 20, scope: 'BATCH', batchId: 'b2' },
    ]);
    prismaMock.submission.count.mockResolvedValueOnce(12).mockResolvedValueOnce(0);

    // Expected = 10 (global) + 2 (batch b2 only) = 12, so 12 submissions is
    // 100%. Counting the batch item against all 10 students would read 60% and
    // make the cohort look permanently behind.
    const result = await AnalyticsService.forCourse('lp1', ['b1', 'b2'], asAdmin);
    expect(result.assignmentCompletionRate).toBe(100);
  });

  it('restricts submissions to students in the batches in scope', async () => {
    await AnalyticsService.forCourse('lp1', ['b1'], asAdmin);

    // An instructor's completion rate must not move because a cohort they do
    // not teach submitted something.
    expect(prismaMock.submission.count.mock.calls[0]![0].where.student).toEqual({
      studentBatches: { some: { batchId: { in: ['b1'] } } },
    });
  });

  it('computes the late rate against submissions, not against students', async () => {
    prismaMock.submission.count.mockResolvedValueOnce(8).mockResolvedValueOnce(2);

    const result = await AnalyticsService.forCourse('lp1', ['b1', 'b2'], asAdmin);
    expect(result.lateSubmissionRate).toBe(25);
  });

  it('reports a per-assignment breakdown including the untouched ones', async () => {
    prismaMock.submission.groupBy.mockResolvedValueOnce([
      { assignmentId: 'a1', _count: { _all: 6 } },
    ]);

    const result = await AnalyticsService.forCourse('lp1', ['b1'], asAdmin);

    // a2 must appear at 0 rather than be missing — "nobody has done it" is the
    // most important row on this list.
    expect(result.submissionsPerAssignment).toEqual([
      { assignmentId: 'a1', title: 'API', submissionCount: 6 },
      { assignmentId: 'a2', title: 'Essay', submissionCount: 0 },
    ]);
  });

  it('returns zeros, not NaN, when the cohort is empty', async () => {
    prismaMock.studentBatch.groupBy.mockResolvedValue([]);

    const result = await AnalyticsService.forCourse('lp1', [], asAdmin);

    expect(result.totalStudents).toBe(0);
    expect(result.assignmentCompletionRate).toBe(0);
    expect(result.averageScore).toBe(0);
    expect(result.lateSubmissionRate).toBe(0);
  });

  it('returns zeros when no assignments have been set', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);

    const result = await AnalyticsService.forCourse('lp1', ['b1'], asAdmin);

    expect(result.assignmentCompletionRate).toBe(0);
    expect(result.submissionsPerAssignment).toEqual([]);
  });
});

// --- 3. Assignment ----------------------------------------------------------

describe('forAssignment', () => {
  it('reports the spread from one aggregate', async () => {
    prismaMock.submission.aggregate.mockResolvedValue({
      _count: { _all: 12, marks: 9 },
      _avg: { marks: 76.44 },
      _max: { marks: 98 },
      _min: { marks: 41 },
    });
    prismaMock.submission.count.mockResolvedValue(3);

    const result = await AnalyticsService.forAssignment('a1');

    expect(result).toEqual({
      totalSubmissions: 12,
      gradedSubmissions: 9,
      averageMarks: 76.4,
      highestMarks: 98,
      lowestMarks: 41,
      lateCount: 3,
    });
  });

  it('reports 0 rather than null when nothing is marked', async () => {
    prismaMock.submission.aggregate.mockResolvedValue({
      _count: { _all: 4, marks: 0 },
      _avg: { marks: null },
      _max: { marks: null },
      _min: { marks: null },
    });

    const result = await AnalyticsService.forAssignment('a1');

    // A client should never have to branch on null to render a number.
    expect(result.averageMarks).toBe(0);
    expect(result.highestMarks).toBe(0);
    expect(result.lowestMarks).toBe(0);
    expect(result.totalSubmissions).toBe(4);
    expect(result.gradedSubmissions).toBe(0);
  });

  it('404s an unknown assignment rather than reporting an empty one', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    await expect(AnalyticsService.forAssignment('nope')).rejects.toThrow('Assignment not found');
  });

  it('reports the whole cohort when no scope is given', async () => {
    await AnalyticsService.forAssignment('a1');

    // The admin view: an empty scope adds no restriction.
    expect(prismaMock.submission.aggregate.mock.calls[0]![0].where).toEqual({
      AND: [{ assignmentId: 'a1' }, {}],
    });
  });

  it('narrows to the viewer scope when one is given (Phase 5)', async () => {
    const scope = { student: { studentBatches: { some: { batchId: { in: ['b1'] } } } } };

    await AnalyticsService.forAssignment('a1', scope);

    // "9 of 12 marked" must not count a parallel cohort's submissions that this
    // instructor cannot open, let alone mark.
    expect(prismaMock.submission.aggregate.mock.calls[0]![0].where.AND).toContainEqual(scope);
  });

  it('applies the scope to the late count as well as the totals', async () => {
    const scope = { student: { studentBatches: { some: { batchId: { in: ['b1'] } } } } };

    await AnalyticsService.forAssignment('a1', scope);

    // Easy to scope one aggregate and forget the other, leaving a late count
    // larger than the total it sits beside.
    expect(prismaMock.submission.count.mock.calls[0]![0].where.AND).toContainEqual(scope);
  });

  it('keeps marks raw, since one assignment has one maximum', async () => {
    prismaMock.submission.aggregate.mockResolvedValue({
      _count: { _all: 1, marks: 1 },
      _avg: { marks: 42 },
      _max: { marks: 42 },
      _min: { marks: 42 },
    });

    // An instructor reads these in the units they marked in.
    const result = await AnalyticsService.forAssignment('a1');
    expect(result.averageMarks).toBe(42);
  });
});

// --- 4. At-risk -------------------------------------------------------------

describe('atRisk', () => {
  const BATCH = { id: 'b1', name: 'MERN-01', learningPathId: 'lp1' };

  const assignment = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    learningPathId: 'lp1',
    isPublished: true,
    scope: 'LEARNING_PATH',
    batchId: null,
    module: { isVisible: true },
    ...over,
  });

  const student = (id: string, name: string) => ({
    id,
    name,
    email: `${id}@example.com`,
    niatId: null,
    studentBatches: [{ batchId: 'b1' }],
  });

  beforeEach(() => {
    prismaMock.batch.findMany.mockResolvedValue([BATCH]);
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1'),
      assignment('a2'),
      assignment('a3'),
      assignment('a4'),
    ]);
    prismaMock.user.findMany.mockResolvedValue([student('s1', 'Asha')]);
    prismaMock.submission.groupBy.mockResolvedValue([]);
  });

  it('flags a student who has submitted nothing', async () => {
    const result = await AnalyticsService.atRisk(['b1']);

    expect(result).toHaveLength(1);
    expect(result[0].reasons).toEqual(['NO_SUBMISSIONS']);
    expect(result[0].progressPercentage).toBe(0);
  });

  it('flags low progress below the threshold', async () => {
    // 1 of 4 = 25%, under 30.
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([]);

    const result = await AnalyticsService.atRisk(['b1']);
    expect(result[0].reasons).toEqual(['LOW_PROGRESS']);
  });

  it('does NOT flag a student above the threshold', async () => {
    // 2 of 4 = 50%.
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 2 } }])
      .mockResolvedValueOnce([]);

    await expect(AnalyticsService.atRisk(['b1'])).resolves.toEqual([]);
  });

  it('flags a student whose submissions are mostly late', async () => {
    // 4 of 4 submitted (100% progress) but 3 late — caught by lateness alone.
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 3 } }]);

    const result = await AnalyticsService.atRisk(['b1']);
    expect(result[0].reasons).toEqual(['MOSTLY_LATE']);
  });

  it('does not flag exactly half late — the rule is MORE than half', async () => {
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 2 } }]);

    await expect(AnalyticsService.atRisk(['b1'])).resolves.toEqual([]);
  });

  it('can report more than one reason at once', async () => {
    // 1 of 4 = 25% AND that one was late.
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 1 } }]);

    const result = await AnalyticsService.atRisk(['b1']);
    expect(result[0].reasons).toEqual(['LOW_PROGRESS', 'MOSTLY_LATE']);
  });

  it('flags nobody when the cohort has no assignments yet', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);

    // Otherwise every student flags at 0/0 on day one, and a signal that fires
    // for everyone is one nobody reads.
    await expect(AnalyticsService.atRisk(['b1'])).resolves.toEqual([]);
  });

  it('excludes draft assignments from the denominator', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1'),
      assignment('a2', { isPublished: false }),
      assignment('a3', { isPublished: false }),
      assignment('a4', { isPublished: false }),
    ]);
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([]);

    // 1 of 1 published = 100%, not 1 of 4. Drafts were never asked for.
    await expect(AnalyticsService.atRisk(['b1'])).resolves.toEqual([]);
  });

  it("excludes another batch's work from the denominator", async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1'),
      assignment('a2', { scope: 'BATCH', batchId: 'other-batch' }),
    ]);
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([]);

    // 1 of 1 that applies to this batch.
    await expect(AnalyticsService.atRisk(['b1'])).resolves.toEqual([]);
  });

  it('counts a batch-scoped assignment for its OWN batch', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1'),
      assignment('a2', { scope: 'BATCH', batchId: 'b1' }),
      assignment('a3'),
      assignment('a4'),
    ]);

    const result = await AnalyticsService.atRisk(['b1']);
    expect(result[0].totalAssignments).toBe(4);
  });

  it('sorts the worst-off first — it is a work queue', async () => {
    prismaMock.user.findMany.mockResolvedValue([student('s1', 'Asha'), student('s2', 'Bilal')]);
    prismaMock.submission.groupBy
      .mockResolvedValueOnce([{ studentId: 's1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([]);

    const result = await AnalyticsService.atRisk(['b1']);

    expect(result.map((r) => r.studentId)).toEqual(['s2', 's1']);
    expect(result[0].progressPercentage).toBe(0);
  });

  it('returns nothing for an empty batch scope without querying', async () => {
    await expect(AnalyticsService.atRisk([])).resolves.toEqual([]);
    expect(prismaMock.batch.findMany).not.toHaveBeenCalled();
  });

  it('does not issue one query per student', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      student('s1', 'A'),
      student('s2', 'B'),
      student('s3', 'C'),
    ]);

    await AnalyticsService.atRisk(['b1']);

    // Two grouped aggregates over Submission regardless of cohort size — the
    // N+1 this screen otherwise ships with.
    expect(prismaMock.submission.groupBy).toHaveBeenCalledTimes(2);
    expect(prismaMock.assignment.findMany).toHaveBeenCalledTimes(1);
  });
});
