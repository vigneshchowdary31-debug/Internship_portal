import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/db';
import { AnalyticsService } from '../services/lms/analytics.service';
import {
  assertCanEvaluate,
  buildVisibilityContext,
  instructorBatchIds,
  resolveReadContext,
  studentBatchId,
  studentWorkScopeFor,
} from '../policies/lms.policy';
import type { AuthenticatedUser } from '../middlewares/auth.middleware';

/**
 * Analytics endpoints (Phase 4).
 *
 * Authorization reuses the LMS policy layer unchanged. The one rule worth
 * stating plainly: cohort-level numbers are NOT student-visible. A completion
 * rate or a class average is other people's performance in aggregate, which is
 * a different privacy question from a student seeing their own standing —
 * hence `assertCanEvaluate` on the course, assignment and at-risk endpoints.
 */

/** Batches a viewer may report on: all of them for an admin, their own for an instructor. */
async function reportableBatchIds(user: AuthenticatedUser, learningPathId?: string): Promise<string[]> {
  if (user.role === 'ADMIN') {
    const batches = await prisma.batch.findMany({
      where: learningPathId ? { learningPathId } : {},
      select: { id: true },
    });
    return batches.map((b) => b.id);
  }

  const ids = await instructorBatchIds(user.id);
  if (!learningPathId) return ids;

  // An instructor asking about a path is answered only for the batches of
  // theirs that actually run it.
  const batches = await prisma.batch.findMany({
    where: { id: { in: ids }, learningPathId },
    select: { id: true },
  });
  return batches.map((b) => b.id);
}

/**
 * GET /api/analytics/student
 *
 * Own standing by default. An admin or instructor may pass `?studentId=` to
 * read someone else's — checked against the batches they actually teach, so an
 * instructor cannot inspect a student from a cohort they have no part in.
 */
export const studentAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const requested = req.query.studentId as string | undefined;

  let targetId = user.id;

  if (requested && requested !== user.id) {
    assertCanEvaluate(user);

    if (user.role === 'INSTRUCTOR') {
      const ids = await instructorBatchIds(user.id);
      const membership = await prisma.studentBatch.findFirst({
        where: { studentId: requested, batchId: { in: ids } },
        select: { batchId: true },
      });
      if (!membership) {
        throw new AppError('That student is not in any of your batches.', 403);
      }
    }
    targetId = requested;
  }

  // The denominator is resolved against the TARGET student's own batch, not the
  // viewer's — an instructor reading a student's progress must see the same
  // numbers the student does.
  const batchId = await studentBatchId(targetId);
  const batch = batchId
    ? await prisma.batch.findUnique({
        where: { id: batchId },
        select: { learningPathId: true },
      })
    : null;

  const learningPathIds = batch?.learningPathId ? [batch.learningPathId] : [];

  const data = await AnalyticsService.forStudent(targetId, learningPathIds, {
    batchId,
    includeUnpublished: false,
  });

  res.status(200).json({
    success: true,
    data,
    ...(learningPathIds.length === 0
      ? { message: 'This student is not assigned to a batch with a curriculum yet.' }
      : {}),
  });
});

/** GET /api/analytics/course/:learningPathId */
export const courseAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  assertCanEvaluate(user);

  const learningPathId = req.params.learningPathId;

  const path = await prisma.learningPath.findUnique({
    where: { id: learningPathId },
    select: { id: true },
  });
  if (!path) throw new AppError('Learning path not found', 404);

  const batchIds = await reportableBatchIds(user, learningPathId);
  if (user.role === 'INSTRUCTOR' && batchIds.length === 0) {
    throw new AppError('None of your batches are running this curriculum.', 403);
  }

  // Authors see drafts in their own curriculum views, but a completion rate
  // measured against unpublished work is meaningless — students were never
  // asked to do it. Analytics always counts the PUBLISHED set.
  const context = await buildVisibilityContext(user);
  const data = await AnalyticsService.forCourse(learningPathId, batchIds, {
    ...context,
    includeUnpublished: false,
  });

  res.status(200).json({ success: true, data });
});

/** GET /api/analytics/assignment/:id */
export const assignmentAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  assertCanEvaluate(user);

  if (user.role === 'INSTRUCTOR') {
    const assignment = await prisma.assignment.findUnique({
      where: { id: req.params.id },
      select: { learningPathId: true },
    });
    if (!assignment) throw new AppError('Assignment not found', 404);

    const batchIds = await reportableBatchIds(user, assignment.learningPathId);
    if (batchIds.length === 0) {
      throw new AppError('This assignment is not part of a curriculum you teach.', 403);
    }
  }

  // Scoped, exactly as GET /instructor/assignment/:id/progress is.
  //
  // Without this the two screens disagreed: the grading list showed an
  // instructor their own batches while this endpoint averaged every cohort on
  // the curriculum, including students they cannot open, let alone mark. The
  // path check above already refuses an assignment outside their curriculum,
  // but "a curriculum I teach" is broader than "students I teach" whenever two
  // batches run the same learning path.
  //
  // `studentWorkScopeFor` returns {} for an admin, so the admin view is
  // unchanged and no branch on role is needed here.
  const scope = await studentWorkScopeFor(user);

  res.status(200).json({
    success: true,
    data: await AnalyticsService.forAssignment(req.params.id, scope),
  });
});

/** GET /api/analytics/at-risk */
export const atRiskStudents = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  assertCanEvaluate(user);

  const requestedBatchId = req.query.batchId as string | undefined;
  let batchIds = await reportableBatchIds(user);

  if (requestedBatchId) {
    if (!batchIds.includes(requestedBatchId)) {
      throw new AppError('You are not assigned to this batch.', 403);
    }
    batchIds = [requestedBatchId];
  }

  const students = await AnalyticsService.atRisk(batchIds);

  res.status(200).json({
    success: true,
    data: students,
    meta: { total: students.length, batchesConsidered: batchIds.length },
  });
});

/**
 * GET /api/analytics/overview
 *
 * The admin landing figure. Kept alongside the four specified endpoints
 * because every other one needs a learning path or a student chosen first, and
 * the dashboard has to render before that choice is made.
 */
export const overviewAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  assertCanEvaluate(user);

  const context = await resolveReadContext(user);
  const batchIds = await reportableBatchIds(user);

  const [totalStudents, activeBatches, totalAssignments, totalSubmissions, lateSubmissions] =
    await prisma.$transaction([
      prisma.user.count({
        where: {
          role: 'STUDENT',
          status: true,
          studentBatches: { some: { batchId: { in: batchIds } } },
        },
      }),
      prisma.batch.count({ where: { id: { in: batchIds }, status: 'ACTIVE' } }),
      prisma.assignment.count({
        where: {
          isPublished: true,
          ...(context.isAdmin ? {} : { learningPathId: { in: context.learningPathIds ?? [] } }),
        },
      }),
      prisma.submission.count({
        where: { student: { studentBatches: { some: { batchId: { in: batchIds } } } } },
      }),
      prisma.submission.count({
        where: {
          isLate: true,
          student: { studentBatches: { some: { batchId: { in: batchIds } } } },
        },
      }),
    ]);

  res.status(200).json({
    success: true,
    data: {
      totalStudents,
      activeBatches,
      totalAssignments,
      totalSubmissions,
      lateSubmissions,
      // "How much of the work that was set actually came in" — 0 rather than
      // null when nothing has been set, so the dashboard renders a number.
      engagementRate:
        totalStudents > 0 && totalAssignments > 0
          ? Math.round((totalSubmissions / (totalStudents * totalAssignments)) * 100)
          : 0,
    },
  });
});
