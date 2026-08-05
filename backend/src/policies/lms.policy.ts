import prisma from '../config/db';
import { AppError } from '../utils/AppError';
import type { AuthenticatedUser } from '../middlewares/auth.middleware';

/**
 * Authorization for the LMS.
 *
 * The existing `restrictTo(...roles)` middleware cannot express the rules this
 * module needs, because the instructor rules are *relational*: "batches I am
 * assigned to", not "users with role INSTRUCTOR". Role alone would let any
 * instructor read any batch's submissions.
 *
 * Two layers, deliberately separated:
 *   - The pure predicates below take already-fetched facts and return booleans.
 *     They are trivially unit-testable and hold the actual rules.
 *   - The async guards wrap them, fetch what they need, and throw AppError.
 */

export type LmsAction =
  | 'curriculum:read'
  | 'curriculum:write'
  | 'content:read'
  | 'content:write'
  | 'batch:manage'
  | 'progress:read';

/** Content/curriculum authoring is admin-only. Instructors teach; they do not upload. */
export function canWriteCurriculum(role: string): boolean {
  return role === 'ADMIN';
}

/**
 * Whether a user may see curriculum belonging to a batch.
 *
 * `batchId` null means the item is global to a learning path — visible to
 * anyone who can see that path at all.
 */
export function canAccessBatch(
  user: { role: string; id: string },
  batchId: string | null | undefined,
  instructorBatchIds: string[],
  studentBatchId: string | null
): boolean {
  if (user.role === 'ADMIN') return true;
  if (!batchId) return true; // global item; path-level checks apply elsewhere
  if (user.role === 'INSTRUCTOR') return instructorBatchIds.includes(batchId);
  if (user.role === 'STUDENT') return studentBatchId === batchId;
  return false;
}

/**
 * Whether a piece of content is currently visible to a STUDENT.
 *
 * Draft and archived items are never visible, and a scheduled item stays hidden
 * until its release moment. Admins and instructors bypass this — they need to
 * see drafts in order to author and review them.
 */
export function isPubliclyVisible(
  content: { status: string; releaseAt: Date | null },
  now: Date = new Date()
): boolean {
  if (content.status !== 'PUBLISHED') return false;
  if (content.releaseAt && content.releaseAt.getTime() > now.getTime()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Async guards
// ---------------------------------------------------------------------------

/** Batch ids an instructor is assigned to. The basis of every instructor scope. */
export async function instructorBatchIds(userId: string): Promise<string[]> {
  const rows = await prisma.instructorBatch.findMany({
    where: { instructorId: userId },
    select: { batchId: true },
  });
  return rows.map((r) => r.batchId);
}

/** The single batch a student belongs to, or null. */
export async function studentBatchId(userId: string): Promise<string | null> {
  const row = await prisma.studentBatch.findFirst({
    where: { studentId: userId },
    select: { batchId: true },
  });
  return row?.batchId ?? null;
}

/** Throws unless the user may author curriculum. */
export function assertCanWriteCurriculum(user: AuthenticatedUser): void {
  if (!canWriteCurriculum(user.role)) {
    throw new AppError(
      'Only administrators can create or modify learning content. Instructors can view and evaluate.',
      403
    );
  }
}

/**
 * Resolves which learning paths a user may read, and the batch context to
 * resolve visibility against.
 *
 * Returning a 403 rather than an empty list for an out-of-scope batch is
 * deliberate: an empty list is ambiguous ("no content" vs "not yours"), and
 * ambiguity in an authorization boundary is how leaks start.
 */
export async function resolveReadContext(user: AuthenticatedUser): Promise<{
  isAdmin: boolean;
  batchIds: string[];
  /** The batch whose overrides apply. Null for admins viewing globally. */
  effectiveBatchId: string | null;
  learningPathIds: string[] | null; // null = unrestricted (admin)
}> {
  if (user.role === 'ADMIN') {
    return { isAdmin: true, batchIds: [], effectiveBatchId: null, learningPathIds: null };
  }

  if (user.role === 'INSTRUCTOR') {
    const ids = await instructorBatchIds(user.id);
    const batches = await prisma.batch.findMany({
      where: { id: { in: ids } },
      select: { id: true, learningPathId: true },
    });
    return {
      isAdmin: false,
      batchIds: ids,
      effectiveBatchId: null, // chosen per-request when an instructor picks a batch
      learningPathIds: batches.map((b) => b.learningPathId).filter(Boolean) as string[],
    };
  }

  const batchId = await studentBatchId(user.id);
  if (!batchId) {
    return { isAdmin: false, batchIds: [], effectiveBatchId: null, learningPathIds: [] };
  }
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { learningPathId: true },
  });
  return {
    isAdmin: false,
    batchIds: [batchId],
    effectiveBatchId: batchId,
    learningPathIds: batch?.learningPathId ? [batch.learningPathId] : [],
  };
}

/**
 * Throws unless the user may read this batch's content.
 * Admins pass; instructors must be assigned; students must belong.
 */
export async function assertCanAccessBatch(
  user: AuthenticatedUser,
  batchId: string
): Promise<void> {
  if (user.role === 'ADMIN') return;

  if (user.role === 'INSTRUCTOR') {
    const ids = await instructorBatchIds(user.id);
    if (!ids.includes(batchId)) {
      throw new AppError('You are not assigned to this batch.', 403);
    }
    return;
  }

  const ownBatch = await studentBatchId(user.id);
  if (ownBatch !== batchId) {
    throw new AppError('You do not have access to this batch.', 403);
  }
}
