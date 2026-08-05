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
