import type { Prisma } from '@prisma/client';

/**
 * The single implementation of "what content can this person see right now".
 *
 * Every read path goes through here. Duplicating the rule anywhere else is how
 * a draft or another batch's material eventually leaks, so this module exports
 * both the Prisma `where` builder and the pure predicate behind it — and
 * nothing else reimplements either.
 *
 * The rule, in one place:
 *
 *   visible(module M, batch B, now T) =
 *         { global items in M, not overridden for B }
 *       ∪ { batch items in M where batchId = B }
 *     filtered by  status = PUBLISHED
 *              AND (releaseAt IS NULL OR releaseAt <= T)
 *
 * Scheduled release is evaluated HERE, at read time, rather than flipped by a
 * job. Nothing can be "missed" because the server was asleep.
 */

export interface VisibilityContext {
  /** Null for admins, who see everything including drafts. */
  batchId: string | null;
  /** Admins and instructors see DRAFT/ARCHIVED and unreleased items. */
  includeUnpublished: boolean;
  /** Injected for testability; defaults to now. */
  now?: Date;
}

/**
 * Pure predicate: is this item visible in this context?
 *
 * Kept separate from the query builder so the rule can be unit-tested without
 * a database, and so in-memory filtering (e.g. after a join) uses exactly the
 * same logic the SQL does.
 */
export function isVisible(
  item: {
    status: string;
    releaseAt: Date | null;
    scope: string;
    batchId: string | null;
    overriddenBy?: { batchId: string | null } | null;
  },
  context: VisibilityContext
): boolean {
  const now = context.now ?? new Date();

  if (!context.includeUnpublished) {
    if (item.status !== 'PUBLISHED') return false;
    if (item.releaseAt && item.releaseAt.getTime() > now.getTime()) return false;
  }

  if (item.scope === 'BATCH') {
    // A batch item is visible only to its own batch.
    return context.batchId !== null && item.batchId === context.batchId;
  }

  // Global item: hidden for a batch that has overridden it.
  if (context.batchId && item.overriddenBy && item.overriddenBy.batchId === context.batchId) {
    return false;
  }

  return true;
}

/**
 * Prisma `where` fragment implementing the same rule in SQL.
 *
 * The override exclusion uses a nested `NOT` on the 1:1 back-relation rather
 * than a subquery, which Prisma compiles to a NOT EXISTS.
 */
export function contentVisibilityWhere(context: VisibilityContext): Prisma.ContentWhereInput {
  const now = context.now ?? new Date();

  const statusClause: Prisma.ContentWhereInput = context.includeUnpublished
    ? {}
    : {
        status: 'PUBLISHED',
        OR: [{ releaseAt: null }, { releaseAt: { lte: now } }],
      };

  // Admin with no batch context: everything, subject only to status.
  if (!context.batchId) {
    return context.includeUnpublished ? {} : statusClause;
  }

  const scopeClause: Prisma.ContentWhereInput = {
    OR: [
      {
        // Global items not overridden for this batch.
        scope: 'LEARNING_PATH',
        NOT: { overriddenBy: { batchId: context.batchId } },
      },
      {
        // This batch's own items (both "inherit + add" and overrides).
        scope: 'BATCH',
        batchId: context.batchId,
      },
    ],
  };

  return context.includeUnpublished ? scopeClause : { AND: [statusClause, scopeClause] };
}

/**
 * Include fragment required for `isVisible` to evaluate overrides in memory.
 * Kept next to the rule so a caller cannot forget it and silently get the
 * wrong answer.
 */
export const VISIBILITY_INCLUDE = {
  overriddenBy: { select: { id: true, batchId: true } },
} satisfies Prisma.ContentInclude;

// ---------------------------------------------------------------------------
// "Publishable" entities — assignments (Phase 3, M1) and quizzes (M2/M3)
//
// The SAME rule, applied to tables with a different shape from Content. It
// lives in this file — not next to the assignment or quiz queries — because the
// whole point of this module is that there is exactly one place to read, review
// and change "who can see what". A copy per entity is how they drift.
//
// Assignment and Quiz carry IDENTICAL visibility columns (`isPublished`,
// `scope`, `batchId`, and a `module` relation), so they share one
// implementation rather than two that merely look alike today. The exported
// wrappers exist only to attach the right Prisma type.
//
// Three deliberate differences from the content rule, each forced by the model
// rather than chosen:
//
//   1. Publication is `isPublished` (two states), not `status` (three). The
//      item is being written or it is set; there is no archived assignment.
//   2. There is no scheduled release. A deadline is not a release gate — a
//      student must keep seeing work after it is due, both to know they missed
//      it and to read the mark they were given.
//   3. There are no per-batch overrides, so no NOT EXISTS clause. A batch that
//      needs different work gets its own batch-scoped item; nothing is being
//      replaced.
//
// Module visibility IS folded in here (`module.isVisible`), because "respect
// the module's visibility" is a visibility rule, and leaving it to each caller
// is precisely the forget-one-query bug this module exists to prevent.
// ---------------------------------------------------------------------------

export interface PublishableItem {
  isPublished: boolean;
  scope: string;
  batchId: string | null;
  module?: { isVisible: boolean } | null;
}

/**
 * Structural shape of the clause built below.
 *
 * Every key is valid on both `Prisma.AssignmentWhereInput` and
 * `Prisma.QuizWhereInput`, which is what makes the cast in the two wrappers
 * sound rather than convenient.
 */
type PublishableWhere = {
  isPublished?: boolean;
  module?: { isVisible: boolean };
  scope?: 'LEARNING_PATH' | 'BATCH';
  batchId?: string;
  OR?: PublishableWhere[];
  AND?: PublishableWhere[];
};

export function isPublishableVisible(
  item: PublishableItem,
  context: VisibilityContext
): boolean {
  if (!context.includeUnpublished) {
    if (!item.isPublished) return false;
    if (item.module && !item.module.isVisible) return false;
  }

  if (item.scope === 'BATCH') {
    return context.batchId !== null && item.batchId === context.batchId;
  }

  return true;
}

function publishableVisibilityWhere(context: VisibilityContext): PublishableWhere {
  const publishedClause: PublishableWhere = context.includeUnpublished
    ? {}
    : { isPublished: true, module: { isVisible: true } };

  if (!context.batchId) {
    // No batch context. An author (admin/instructor) sees everything; a student
    // without a batch can only ever see path-global work — never another
    // batch's. Returning the bare status clause here would leak batch-scoped
    // items to an unassigned student, so the scope is pinned explicitly.
    return context.includeUnpublished
      ? {}
      : { AND: [publishedClause, { scope: 'LEARNING_PATH' }] };
  }

  const scopeClause: PublishableWhere = {
    OR: [{ scope: 'LEARNING_PATH' }, { scope: 'BATCH', batchId: context.batchId }],
  };

  return context.includeUnpublished ? scopeClause : { AND: [publishedClause, scopeClause] };
}

/** Pure predicate for an assignment. */
export const isAssignmentVisible = isPublishableVisible;

/** Pure predicate for a quiz. Same rule, same columns. */
export const isQuizVisible = isPublishableVisible;

/** Prisma `where` fragment implementing `isAssignmentVisible` in SQL. */
export function assignmentVisibilityWhere(
  context: VisibilityContext
): Prisma.AssignmentWhereInput {
  return publishableVisibilityWhere(context) as Prisma.AssignmentWhereInput;
}

/** Prisma `where` fragment implementing `isQuizVisible` in SQL. */
export function quizVisibilityWhere(context: VisibilityContext): Prisma.QuizWhereInput {
  return publishableVisibilityWhere(context) as Prisma.QuizWhereInput;
}
