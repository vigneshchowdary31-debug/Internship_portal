import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const announce = vi.fn();
vi.mock('./notification.service', () => ({
  NotificationService: { announceAssignmentPublished: (...a: unknown[]) => announce(...a) },
}));

const { AssignmentService } = await import('./assignment.service');

const MODULE = { id: 'm1', learningPathId: 'lp1' };
const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + 7 * 24 * HOUR);
const past = () => new Date(Date.now() - 24 * HOUR);

const base = () => ({
  moduleId: 'm1',
  title: 'Build a REST API',
  description: '<p>Ship a CRUD service.</p>',
  maxMarks: 100,
  deadline: future(),
  createdById: 'admin1',
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.module.findUnique.mockResolvedValue(MODULE);
  prismaMock.batch.findUnique.mockResolvedValue({ id: 'b1', name: 'MERN-01', learningPathId: 'lp1' });
  prismaMock.assignment.create.mockResolvedValue({ id: 'a1', isPublished: false });
  prismaMock.assignment.update.mockResolvedValue({ id: 'a1', isPublished: true });
  prismaMock.assignment.findUnique.mockResolvedValue({
    id: 'a1',
    isPublished: false,
    publishedAt: null,
    deadline: future(),
  });
  prismaMock.assignment.findUniqueOrThrow.mockResolvedValue({ id: 'a1', isPublished: false });
  prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
  prismaMock.assignment.findMany.mockResolvedValue([]);
  prismaMock.assignment.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  announce.mockResolvedValue(null);
});

// --- Create -----------------------------------------------------------------

describe('create', () => {
  it('denormalises the learning path from the module', async () => {
    await AssignmentService.create(base());

    // Carried one hop up so the student-facing visibility query needs no join.
    expect(prismaMock.assignment.create.mock.calls[0]![0].data.learningPathId).toBe('lp1');
  });

  it('rejects an unknown module before writing anything', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);

    await expect(AssignmentService.create(base())).rejects.toThrow('Module not found');
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('defaults to a draft', async () => {
    await AssignmentService.create(base());
    expect(announce).not.toHaveBeenCalled();
  });

  it('publishes and notifies when asked to at creation time', async () => {
    await AssignmentService.create({ ...base(), isPublished: true });
    expect(announce).toHaveBeenCalledWith('a1', 'admin1');
  });

  it('trims the title and description', async () => {
    await AssignmentService.create({ ...base(), title: '  Spaced  ', description: '  Body  ' });

    const { title, description } = prismaMock.assignment.create.mock.calls[0]![0].data;
    expect(title).toBe('Spaced');
    expect(description).toBe('Body');
  });
});

describe('create — deadline validation', () => {
  it('rejects a deadline in the past', async () => {
    await expect(AssignmentService.create({ ...base(), deadline: past() })).rejects.toThrow(
      /must be in the future/
    );
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('rejects a deadline of exactly now', async () => {
    // The boundary belongs to the past: an assignment due at the instant it is
    // set is already unsubmittable.
    await expect(AssignmentService.create({ ...base(), deadline: new Date() })).rejects.toThrow(
      /must be in the future/
    );
  });

  it('rejects an unparseable date rather than storing Invalid Date', async () => {
    await expect(
      AssignmentService.create({ ...base(), deadline: new Date('not-a-date') })
    ).rejects.toThrow(/not a valid date/);
  });

  it('accepts a deadline in the future', async () => {
    await expect(AssignmentService.create(base())).resolves.toBeTruthy();
  });
});

describe('create — batch scoping', () => {
  it('stores no batch for path-global work', async () => {
    await AssignmentService.create(base());

    const data = prismaMock.assignment.create.mock.calls[0]![0].data;
    expect(data.scope).toBe('LEARNING_PATH');
    expect(data.batchId).toBeNull();
  });

  it('requires a batch when the scope is BATCH', async () => {
    await expect(
      AssignmentService.create({ ...base(), scope: 'BATCH', batchId: null })
    ).rejects.toThrow(/batch is required/);
  });

  it("refuses a batch running a different curriculum", async () => {
    prismaMock.batch.findUnique.mockResolvedValue({
      id: 'b2',
      name: 'Java-03',
      learningPathId: 'lp-other',
    });

    // Reuses the shared batch-scope check rather than a second copy of it.
    await expect(
      AssignmentService.create({ ...base(), scope: 'BATCH', batchId: 'b2' })
    ).rejects.toThrow(/different learning path/);
  });

  it('accepts a batch on the same curriculum', async () => {
    await expect(
      AssignmentService.create({ ...base(), scope: 'BATCH', batchId: 'b1' })
    ).resolves.toBeTruthy();
    expect(prismaMock.assignment.create.mock.calls[0]![0].data.batchId).toBe('b1');
  });
});

// --- Publish ----------------------------------------------------------------

describe('setPublished — notifies exactly once', () => {
  it('announces on a draft -> published transition', async () => {
    await AssignmentService.setPublished('a1', true, 'admin1');
    expect(announce).toHaveBeenCalledWith('a1', 'admin1');
  });

  it('does NOT re-announce an already published assignment', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      publishedAt: new Date(),
      deadline: future(),
    });

    await AssignmentService.setPublished('a1', true, 'admin1');

    // Students who get the same alert twice learn to ignore the channel.
    expect(announce).not.toHaveBeenCalled();
  });

  it('does not announce a withdrawal', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      publishedAt: new Date(),
      deadline: future(),
    });

    await AssignmentService.setPublished('a1', false, 'admin1');
    expect(announce).not.toHaveBeenCalled();
  });

  it('refuses to publish work whose deadline has already passed', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      isPublished: false,
      publishedAt: null,
      deadline: past(),
    });

    await expect(AssignmentService.setPublished('a1', true, 'admin1')).rejects.toThrow(
      /past its deadline/
    );
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('allows withdrawing an overdue assignment', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      publishedAt: new Date(),
      deadline: past(),
    });

    // The deadline gate guards publishing, not unpublishing — an assignment set
    // in error must stay retractable after its date has passed.
    await expect(AssignmentService.setPublished('a1', false, 'admin1')).resolves.toBeTruthy();
  });

  it('stamps publishedAt on the first publish only', async () => {
    await AssignmentService.setPublished('a1', true, null);
    expect(prismaMock.assignment.update.mock.calls[0]![0].data.publishedAt).toBeInstanceOf(Date);
  });

  it('keeps the original publishedAt when re-publishing', async () => {
    const original = new Date('2026-01-01T00:00:00Z');
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      isPublished: false,
      publishedAt: original,
      deadline: future(),
    });

    await AssignmentService.setPublished('a1', true, null);

    // "When was this set" must stay truthful across a withdraw/re-publish.
    expect(prismaMock.assignment.update.mock.calls[0]![0].data.publishedAt).toBeUndefined();
  });

  it('still publishes when notifying throws', async () => {
    announce.mockRejectedValue(new Error('SMTP down'));

    // The assignment is live at this point; an error would invite a retry that
    // double-notifies the whole cohort.
    await expect(AssignmentService.setPublished('a1', true, null)).resolves.toBeTruthy();
    expect(prismaMock.assignment.update).toHaveBeenCalled();
  });

  it('rejects an unknown id before touching notifications', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    await expect(AssignmentService.setPublished('nope', true, null)).rejects.toThrow(
      'Assignment not found'
    );
    expect(announce).not.toHaveBeenCalled();
  });
});

// --- Update -----------------------------------------------------------------

describe('update', () => {
  it('rejects moving a deadline into the past', async () => {
    // The more damaging direction: a deadline quietly moved backwards under
    // students who are mid-submission.
    await expect(AssignmentService.update('a1', { deadline: past() })).rejects.toThrow(
      /must be in the future/
    );
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('extends a deadline forwards', async () => {
    await AssignmentService.update('a1', { deadline: future() });
    expect(prismaMock.assignment.update.mock.calls[0]![0].data.deadline).toBeInstanceOf(Date);
  });

  it('leaves untouched fields out of the update', async () => {
    await AssignmentService.update('a1', { title: 'Renamed' });

    const data = prismaMock.assignment.update.mock.calls[0]![0].data;
    expect(data).toEqual({ title: 'Renamed' });
  });

  it('cannot publish through the edit path', async () => {
    await AssignmentService.update('a1', { title: 'Renamed' });

    // A fan-out to every student must not be reachable from a title fix.
    expect(announce).not.toHaveBeenCalled();
    expect(prismaMock.assignment.update.mock.calls[0]![0].data.isPublished).toBeUndefined();
  });
});

describe('update — a moved deadline re-derives lateness (Phase 3 M2)', () => {
  const original = new Date(Date.now() + 24 * HOUR);
  const extended = new Date(Date.now() + 5 * 24 * HOUR);

  beforeEach(() => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      publishedAt: new Date(),
      deadline: original,
    });
  });

  it('un-flags submissions that fall inside an extended deadline', async () => {
    await AssignmentService.update('a1', { deadline: extended });

    // The whole point of granting an extension: students who handed in during
    // the extra window were flagged late at write time and must not stay late.
    expect(prismaMock.submission.updateMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', submittedAt: { lte: extended } },
      data: { isLate: false },
    });
  });

  it('flags submissions that now fall outside it', async () => {
    await AssignmentService.update('a1', { deadline: extended });

    expect(prismaMock.submission.updateMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', submittedAt: { gt: extended } },
      data: { isLate: true },
    });
  });

  it('rewrites both halves in one transaction', async () => {
    await AssignmentService.update('a1', { deadline: extended });

    // Either both land or neither does; a half-applied recompute would leave
    // the cohort split between two deadlines.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the deadline is unchanged', async () => {
    await AssignmentService.update('a1', { deadline: new Date(original.getTime()) });
    expect(prismaMock.submission.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when the deadline is not part of the edit', async () => {
    await AssignmentService.update('a1', { title: 'Renamed' });
    expect(prismaMock.submission.updateMany).not.toHaveBeenCalled();
  });
});

// --- Reads ------------------------------------------------------------------

describe('list — visibility is never optional', () => {
  const asStudent = { batchId: 'b1', includeUnpublished: false };
  const asAdmin = { batchId: null, includeUnpublished: true };

  const whereOf = () => prismaMock.assignment.findMany.mock.calls[0]![0].where;

  it('AND-s every query with the shared visibility clause', async () => {
    await AssignmentService.list({ moduleId: 'm1' }, asStudent);

    const conditions = whereOf().AND;
    // The visibility clause is always first, ahead of any caller filter.
    expect(conditions[0]).toEqual({
      AND: [
        { isPublished: true, module: { isVisible: true } },
        { OR: [{ scope: 'LEARNING_PATH' }, { scope: 'BATCH', batchId: 'b1' }] },
      ],
    });
  });

  it('keeps the visibility clause even when a status filter is supplied', async () => {
    // A student asking for status=draft must still get nothing, not drafts.
    await AssignmentService.list({ status: 'draft' }, asStudent);

    const conditions = whereOf().AND;
    expect(conditions[0]).toHaveProperty('AND');
    expect(conditions).toContainEqual({ isPublished: false });
  });

  it('applies the module filter alongside visibility, not instead of it', async () => {
    await AssignmentService.list({ moduleId: 'm1' }, asStudent);
    expect(whereOf().AND).toContainEqual({ moduleId: 'm1' });
  });

  it('restricts to every reachable path, not just the first', async () => {
    // An instructor teaching two stacks must see both — losing one silently is
    // worse than an error.
    await AssignmentService.list({ learningPathIds: ['lp1', 'lp2'] }, asAdmin);
    expect(whereOf().AND).toContainEqual({ learningPathId: { in: ['lp1', 'lp2'] } });
  });

  it('honours an empty reachable-path set as "nothing", not "no filter"', async () => {
    await AssignmentService.list({ learningPathIds: [] }, asAdmin);
    expect(whereOf().AND).toContainEqual({ learningPathId: { in: [] } });
  });

  it('searches title and description case-insensitively', async () => {
    await AssignmentService.list({ q: 'rest api' }, asAdmin);

    expect(whereOf().AND).toContainEqual({
      OR: [
        { title: { contains: 'rest api', mode: 'insensitive' } },
        { description: { contains: 'rest api', mode: 'insensitive' } },
      ],
    });
  });

  it('filters by due-date window', async () => {
    const before = new Date('2026-09-01T00:00:00Z');
    const after = new Date('2026-08-01T00:00:00Z');

    await AssignmentService.list({ dueBefore: before, dueAfter: after }, asAdmin);

    expect(whereOf().AND).toContainEqual({ deadline: { lte: before } });
    expect(whereOf().AND).toContainEqual({ deadline: { gte: after } });
  });

  it('orders by deadline ascending by default', async () => {
    await AssignmentService.list({}, asAdmin);

    // "What is due next" is the question this screen answers.
    expect(prismaMock.assignment.findMany.mock.calls[0]![0].orderBy).toEqual([
      { deadline: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('honours an explicit sort', async () => {
    await AssignmentService.list({ sort: '-createdAt' }, asAdmin);
    expect(prismaMock.assignment.findMany.mock.calls[0]![0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('computes skip and take from the page', async () => {
    await AssignmentService.list({ page: 3, pageSize: 10 }, asAdmin);

    const call = prismaMock.assignment.findMany.mock.calls[0]![0];
    expect(call.skip).toBe(20);
    expect(call.take).toBe(10);
  });

  it('caps pageSize', async () => {
    await AssignmentService.list({ pageSize: 5000 }, asAdmin);
    expect(prismaMock.assignment.findMany.mock.calls[0]![0].take).toBe(100);
  });

  it('reports hasMore from the total', async () => {
    prismaMock.assignment.count.mockResolvedValue(30);

    const result = await AssignmentService.list({ page: 1, pageSize: 25 }, asAdmin);

    expect(result.total).toBe(30);
    expect(result.hasMore).toBe(true);
    expect(result.totalPages).toBe(2);
  });
});

describe('getById — an invisible assignment is not found', () => {
  it('resolves through the visibility clause rather than fetching then checking', async () => {
    await AssignmentService.getById('a1', { batchId: 'b1', includeUnpublished: false });

    const where = prismaMock.assignment.findFirst.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ id: 'a1' });
    expect(where.AND[1]).toBeTruthy();
  });

  it('404s a draft for a student instead of 403ing it', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    // A 403 would confirm the draft exists. "Not found" tells them nothing.
    await expect(
      AssignmentService.getById('a1', { batchId: 'b1', includeUnpublished: false })
    ).rejects.toThrow('Assignment not found');
  });
});

describe('remove', () => {
  beforeEach(() => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Build a REST API',
      isPublished: true,
      publishedAt: new Date(),
      deadline: future(),
    });
    prismaMock.submission.count.mockResolvedValue(0);
  });

  it('404s an unknown assignment rather than reporting a phantom success', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    await expect(AssignmentService.remove('nope')).rejects.toThrow('Assignment not found');
    expect(prismaMock.assignment.delete).not.toHaveBeenCalled();
  });

  it('deletes an assignment with NO submissions', async () => {
    await expect(AssignmentService.remove('a1')).resolves.toBe(true);
    expect(prismaMock.assignment.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('counts submissions for THIS assignment before deleting', async () => {
    await AssignmentService.remove('a1');
    expect(prismaMock.submission.count).toHaveBeenCalledWith({ where: { assignmentId: 'a1' } });
  });
});

describe('remove — submissions are never destroyed by a delete', () => {
  beforeEach(() => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Build a REST API',
      isPublished: true,
      publishedAt: new Date(),
      deadline: future(),
    });
  });

  it('refuses to delete an assignment that has submissions', async () => {
    prismaMock.submission.count.mockResolvedValue(3);

    await expect(AssignmentService.remove('a1')).rejects.toThrow(
      /3 student submission\(s\) exist/
    );
  });

  it('does NOT delete the assignment, so the cascade never fires', async () => {
    prismaMock.submission.count.mockResolvedValue(1);

    await expect(AssignmentService.remove('a1')).rejects.toThrow();

    // This is the whole point. Submission.assignmentId is onDelete: Cascade, so
    // the ONLY thing preventing the loss of student work is this call not
    // happening. There is no database error to fall back on.
    expect(prismaMock.assignment.delete).not.toHaveBeenCalled();
    expect(prismaMock.submission.delete).not.toHaveBeenCalled();
    expect(prismaMock.submission.updateMany).not.toHaveBeenCalled();
  });

  it('answers 409 Conflict, not 400', async () => {
    prismaMock.submission.count.mockResolvedValue(1);

    // The request is well-formed; it is the state of the resource that makes
    // it impossible.
    await expect(AssignmentService.remove('a1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('points at the action that actually exists', async () => {
    prismaMock.submission.count.mockResolvedValue(1);

    // There is no ARCHIVED state for an assignment — only isPublished. The
    // message must name the thing an admin can really do.
    await expect(AssignmentService.remove('a1')).rejects.toThrow(/Withdraw it instead/);
  });

  it('blocks on a single submission, not just on several', async () => {
    prismaMock.submission.count.mockResolvedValue(1);

    await expect(AssignmentService.remove('a1')).rejects.toThrow(
      /1 student submission\(s\) exist/
    );
  });
});
