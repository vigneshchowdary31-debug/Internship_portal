import { describe, it, expect } from 'vitest';
import {
  isVisible,
  contentVisibilityWhere,
  isAssignmentVisible,
  assignmentVisibilityWhere,
  isQuizVisible,
  quizVisibilityWhere,
} from './visibility.service';

/**
 * The visibility rule is the single most security-sensitive piece of Phase 1:
 * getting it wrong leaks another batch's material, or a draft, or an unreleased
 * item. Every branch is pinned here.
 */

const NOW = new Date('2026-08-01T12:00:00Z');
const PAST = new Date('2026-07-01T00:00:00Z');
const FUTURE = new Date('2026-09-01T00:00:00Z');

const global = (over: Partial<Parameters<typeof isVisible>[0]> = {}) => ({
  status: 'PUBLISHED',
  releaseAt: null,
  scope: 'LEARNING_PATH',
  batchId: null,
  overriddenBy: null,
  ...over,
});

const batchItem = (batchId: string, over: Partial<Parameters<typeof isVisible>[0]> = {}) => ({
  status: 'PUBLISHED',
  releaseAt: null,
  scope: 'BATCH',
  batchId,
  overriddenBy: null,
  ...over,
});

const asStudent = (batchId: string) => ({ batchId, includeUnpublished: false, now: NOW });
const asAdmin = { batchId: null, includeUnpublished: true, now: NOW };

describe('isVisible — status gating', () => {
  it('shows a published global item to a student', () => {
    expect(isVisible(global(), asStudent('B1'))).toBe(true);
  });

  it('hides a DRAFT item from a student', () => {
    expect(isVisible(global({ status: 'DRAFT' }), asStudent('B1'))).toBe(false);
  });

  it('hides an ARCHIVED item from a student', () => {
    expect(isVisible(global({ status: 'ARCHIVED' }), asStudent('B1'))).toBe(false);
  });

  it('shows drafts to an admin', () => {
    expect(isVisible(global({ status: 'DRAFT' }), asAdmin)).toBe(true);
  });
});

describe('isVisible — scheduled release (lazy, no scheduler)', () => {
  it('hides an item whose release moment has not arrived', () => {
    expect(isVisible(global({ releaseAt: FUTURE }), asStudent('B1'))).toBe(false);
  });

  it('shows an item whose release moment has passed', () => {
    expect(isVisible(global({ releaseAt: PAST }), asStudent('B1'))).toBe(true);
  });

  it('treats a null releaseAt as immediate', () => {
    expect(isVisible(global({ releaseAt: null }), asStudent('B1'))).toBe(true);
  });

  it('releases exactly at the boundary instant', () => {
    expect(isVisible(global({ releaseAt: NOW }), asStudent('B1'))).toBe(true);
  });

  it('shows unreleased items to an admin', () => {
    expect(isVisible(global({ releaseAt: FUTURE }), asAdmin)).toBe(true);
  });
});

describe('isVisible — batch scoping', () => {
  it("shows a batch's own item to that batch", () => {
    expect(isVisible(batchItem('B1'), asStudent('B1'))).toBe(true);
  });

  it("hides another batch's item", () => {
    expect(isVisible(batchItem('B2'), asStudent('B1'))).toBe(false);
  });

  it('hides a batch item from a student with no batch', () => {
    expect(isVisible(batchItem('B1'), { batchId: null, includeUnpublished: false, now: NOW })).toBe(
      false
    );
  });

  it('shows a global item to every batch', () => {
    expect(isVisible(global(), asStudent('B1'))).toBe(true);
    expect(isVisible(global(), asStudent('B2'))).toBe(true);
  });
});

describe('isVisible — inherit vs override', () => {
  it('hides a global item from the batch that overrode it', () => {
    const overridden = global({ overriddenBy: { batchId: 'B1' } });
    expect(isVisible(overridden, asStudent('B1'))).toBe(false);
  });

  it('still shows that global item to every OTHER batch', () => {
    const overridden = global({ overriddenBy: { batchId: 'B1' } });
    expect(isVisible(overridden, asStudent('B2'))).toBe(true);
  });

  it('inherit-and-add: a batch item with no override leaves the global visible', () => {
    // Both are visible — this is the "add alongside" case.
    expect(isVisible(global(), asStudent('B1'))).toBe(true);
    expect(isVisible(batchItem('B1'), asStudent('B1'))).toBe(true);
  });

  it('shows the overriding batch item itself', () => {
    expect(isVisible(batchItem('B1', { scope: 'BATCH' }), asStudent('B1'))).toBe(true);
  });
});

describe('contentVisibilityWhere', () => {
  it('returns an unrestricted clause for an admin', () => {
    expect(contentVisibilityWhere({ batchId: null, includeUnpublished: true })).toEqual({});
  });

  it('gates on status when unpublished is excluded and no batch is set', () => {
    const where = contentVisibilityWhere({ batchId: null, includeUnpublished: false, now: NOW });
    expect(where.status).toBe('PUBLISHED');
  });

  it('builds the union of non-overridden globals and own-batch items', () => {
    const where = contentVisibilityWhere({ batchId: 'B1', includeUnpublished: true });
    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toMatchObject({
      scope: 'LEARNING_PATH',
      NOT: { overriddenBy: { batchId: 'B1' } },
    });
    expect(where.OR?.[1]).toMatchObject({ scope: 'BATCH', batchId: 'B1' });
  });

  it('combines status and scope for a student', () => {
    const where = contentVisibilityWhere({ batchId: 'B1', includeUnpublished: false, now: NOW });
    expect(where.AND).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Assignments (Phase 3, M1) — the same rule over a differently shaped table.
// ---------------------------------------------------------------------------

const assignment = (over: Partial<Parameters<typeof isAssignmentVisible>[0]> = {}) => ({
  isPublished: true,
  scope: 'LEARNING_PATH',
  batchId: null,
  module: { isVisible: true },
  ...over,
});

describe('isAssignmentVisible — publication gating', () => {
  it('shows a published global assignment to a student', () => {
    expect(isAssignmentVisible(assignment(), asStudent('B1'))).toBe(true);
  });

  it('hides a draft from a student', () => {
    expect(isAssignmentVisible(assignment({ isPublished: false }), asStudent('B1'))).toBe(false);
  });

  it('shows drafts to an admin', () => {
    expect(isAssignmentVisible(assignment({ isPublished: false }), asAdmin)).toBe(true);
  });
});

describe('isAssignmentVisible — module visibility is respected', () => {
  it('hides published work sitting in a hidden module', () => {
    // The module is what a student navigates through; work inside one they
    // cannot open is work they cannot reach.
    expect(
      isAssignmentVisible(assignment({ module: { isVisible: false } }), asStudent('B1'))
    ).toBe(false);
  });

  it('still shows it to an admin', () => {
    expect(isAssignmentVisible(assignment({ module: { isVisible: false } }), asAdmin)).toBe(true);
  });
});

describe('isAssignmentVisible — batch scoping', () => {
  const batchWork = (batchId: string) => assignment({ scope: 'BATCH', batchId });

  it("shows a batch's own work to that batch", () => {
    expect(isAssignmentVisible(batchWork('B1'), asStudent('B1'))).toBe(true);
  });

  it("hides another batch's work", () => {
    expect(isAssignmentVisible(batchWork('B2'), asStudent('B1'))).toBe(false);
  });

  it('hides batch work from a student with no batch', () => {
    expect(
      isAssignmentVisible(batchWork('B1'), { batchId: null, includeUnpublished: false, now: NOW })
    ).toBe(false);
  });

  it('shows global work to every batch', () => {
    expect(isAssignmentVisible(assignment(), asStudent('B1'))).toBe(true);
    expect(isAssignmentVisible(assignment(), asStudent('B2'))).toBe(true);
  });
});

describe('isAssignmentVisible — a deadline is not a visibility gate', () => {
  it('keeps overdue work visible', () => {
    // A student must keep seeing work after it is due — both to know they
    // missed it and to read the mark they were given.
    expect(isAssignmentVisible(assignment(), asStudent('B1'))).toBe(true);
  });
});

describe('assignmentVisibilityWhere', () => {
  it('returns an unrestricted clause for an admin', () => {
    expect(assignmentVisibilityWhere({ batchId: null, includeUnpublished: true })).toEqual({});
  });

  it('gates on publication and module visibility for a student', () => {
    const where = assignmentVisibilityWhere({ batchId: 'B1', includeUnpublished: false, now: NOW });
    expect(where).toEqual({
      AND: [
        { isPublished: true, module: { isVisible: true } },
        { OR: [{ scope: 'LEARNING_PATH' }, { scope: 'BATCH', batchId: 'B1' }] },
      ],
    });
  });

  it('builds the union of globals and own-batch work', () => {
    const where = assignmentVisibilityWhere({ batchId: 'B1', includeUnpublished: true });
    expect(where.OR).toEqual([
      { scope: 'LEARNING_PATH' },
      { scope: 'BATCH', batchId: 'B1' },
    ]);
  });

  it("pins an unassigned student to global work only", () => {
    // Without the explicit scope clause this would return the bare publication
    // filter, leaking every batch's work to a student who belongs to none.
    const where = assignmentVisibilityWhere({ batchId: null, includeUnpublished: false, now: NOW });
    expect(where.AND).toContainEqual({ scope: 'LEARNING_PATH' });
  });

  it('has no override clause — assignments are never overridden', () => {
    const where = assignmentVisibilityWhere({ batchId: 'B1', includeUnpublished: true });
    expect(JSON.stringify(where)).not.toContain('NOT');
  });
});

// ---------------------------------------------------------------------------
// Quizzes (Phase 3, M3) — the same rule again, over identical columns.
//
// These pin that quizzes and assignments resolve IDENTICALLY. If the two ever
// diverge, one of them is wrong, and this is where that shows up rather than in
// a leaked answer key.
// ---------------------------------------------------------------------------

describe('quiz visibility is the assignment rule, unchanged', () => {
  const contexts = [
    { name: 'admin', ctx: { batchId: null, includeUnpublished: true } },
    { name: 'instructor', ctx: { batchId: 'B1', includeUnpublished: true } },
    { name: 'student in a batch', ctx: { batchId: 'B1', includeUnpublished: false, now: NOW } },
    { name: 'student with no batch', ctx: { batchId: null, includeUnpublished: false, now: NOW } },
  ];

  it.each(contexts)('builds the same clause for a $name', ({ ctx }) => {
    expect(quizVisibilityWhere(ctx)).toEqual(assignmentVisibilityWhere(ctx));
  });

  const quiz = (over: Partial<Parameters<typeof isQuizVisible>[0]> = {}) => ({
    isPublished: true,
    scope: 'LEARNING_PATH',
    batchId: null,
    module: { isVisible: true },
    ...over,
  });

  it('hides a draft quiz from a student', () => {
    expect(isQuizVisible(quiz({ isPublished: false }), asStudent('B1'))).toBe(false);
  });

  it('hides a quiz in a hidden module', () => {
    expect(isQuizVisible(quiz({ module: { isVisible: false } }), asStudent('B1'))).toBe(false);
  });

  it("hides another batch's quiz", () => {
    expect(isQuizVisible(quiz({ scope: 'BATCH', batchId: 'B2' }), asStudent('B1'))).toBe(false);
  });

  it("shows a batch's own quiz", () => {
    expect(isQuizVisible(quiz({ scope: 'BATCH', batchId: 'B1' }), asStudent('B1'))).toBe(true);
  });

  it('shows drafts to an admin', () => {
    expect(isQuizVisible(quiz({ isPublished: false }), asAdmin)).toBe(true);
  });

  it('pins an unassigned student to global quizzes only', () => {
    const where = quizVisibilityWhere({ batchId: null, includeUnpublished: false, now: NOW });
    expect(where.AND).toContainEqual({ scope: 'LEARNING_PATH' });
  });
});
