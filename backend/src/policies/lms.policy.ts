import prisma from '../config/db';
import { AppError } from '../utils/AppError';
import type { AuthenticatedUser } from '../middlewares/auth.middleware';
import type { VisibilityContext } from '../services/lms/visibility.service';

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
 * Builds the visibility context for a request.
 *
 * Admins and instructors see drafts and unreleased items because they author
 * and review them; students never do. The batch whose overrides apply is the
 * student's own, or — for an instructor — one they explicitly asked for and are
 * assigned to.
 *
 * Lifted out of lms.controller.ts in Phase 3 when assignments needed the same
 * context. Behaviour is unchanged; it belongs here because deciding what a
 * caller may see is a policy question, and a second copy in a second controller
 * is how an instructor eventually reads a batch they were never assigned.
 */
export async function buildVisibilityContext(
  user: AuthenticatedUser,
  requestedBatchId?: string
): Promise<VisibilityContext> {
  if (user.role === 'ADMIN') {
    return { batchId: requestedBatchId ?? null, includeUnpublished: true };
  }

  if (user.role === 'INSTRUCTOR') {
    if (requestedBatchId) await assertCanAccessBatch(user, requestedBatchId);
    return { batchId: requestedBatchId ?? null, includeUnpublished: true };
  }

  const context = await resolveReadContext(user);
  return { batchId: context.effectiveBatchId, includeUnpublished: false };
}

/**
 * Students and instructors may only read curriculum belonging to a path their
 * batches actually run.
 *
 * Returning 403 rather than an empty list keeps the boundary unambiguous: an
 * empty list means "no content" and "not yours" at the same time, and ambiguity
 * in an authorization boundary is how leaks start.
 */
export async function assertCanReadPath(
  user: AuthenticatedUser,
  learningPathId: string
): Promise<void> {
  if (user.role === 'ADMIN') return;

  const context = await resolveReadContext(user);
  if (!context.learningPathIds || context.learningPathIds.includes(learningPathId)) return;

  throw new AppError('You do not have access to this curriculum.', 403);
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

// ---------------------------------------------------------------------------
// Submissions (Phase 3, M2)
//
// Composed from the predicates above rather than expressed as new rules. The
// only genuinely new fact is that handing work in is a STUDENT action — every
// other question ("which students may this instructor see") is answered by
// `instructorBatchIds`, which already exists.
// ---------------------------------------------------------------------------

/** Only students hand work in. Admins and instructors evaluate it. */
export function assertCanSubmit(user: AuthenticatedUser): void {
  if (user.role !== 'STUDENT') {
    throw new AppError(
      'Only students can submit work. Administrators and instructors can view and evaluate submissions.',
      403
    );
  }
}

/** Evaluating is the instructor's job, and the admin's by inheritance. */
export function assertCanEvaluate(user: AuthenticatedUser): void {
  if (user.role !== 'ADMIN' && user.role !== 'INSTRUCTOR') {
    throw new AppError('Only instructors and administrators can mark submissions.', 403);
  }
}

/**
 * The scope of student work a viewer may read, as a Prisma filter.
 *
 * Returned as a `where` fragment rather than checked per row: the alternative
 * is fetching a page and filtering afterwards, which silently breaks pagination
 * totals and leaks the COUNT of work the viewer cannot see even when it hides
 * the rows themselves.
 *
 * - Admin: unrestricted.
 * - Instructor: students in the batches they are assigned to.
 * - Student: their own work, and nothing else.
 *
 * Applies to any table with a `studentId` and a `student` relation — Submission
 * (M2) and Attempt (M3) both qualify, and the rule is identical for both.
 */
export interface StudentWorkScope {
  studentId?: string;
  student?: { studentBatches: { some: { batchId: { in: string[] } } } };
}

export async function studentWorkScopeFor(user: AuthenticatedUser): Promise<StudentWorkScope> {
  if (user.role === 'ADMIN') return {};

  if (user.role === 'INSTRUCTOR') {
    const ids = await instructorBatchIds(user.id);
    return { student: { studentBatches: { some: { batchId: { in: ids } } } } };
  }

  return { studentId: user.id };
}

/** M2's name for the same rule. Kept so the submission paths read unchanged. */
export const submissionScopeFor = studentWorkScopeFor;
