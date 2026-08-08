import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/db';
import { AssignmentService } from '../services/lms/assignment.service';
import {
  assertCanReadPath,
  assertCanWriteCurriculum,
  buildVisibilityContext,
  resolveReadContext,
} from '../policies/lms.policy';

/**
 * Assignments (Phase 3, M1).
 *
 * Authorization reuses the LMS policy layer verbatim — `assertCanWriteCurriculum`
 * for writes, `assertCanReadPath` for reads, `buildVisibilityContext` for the
 * resolver. No assignment-specific access rule is introduced: an assignment is
 * curriculum, and inventing a parallel rule set for it is how the two eventually
 * disagree about who may touch a batch.
 */

function contextFor(req: Request) {
  return buildVisibilityContext(req.user!, (req.query.batchId as string | undefined) || undefined);
}

/** ISO strings arrive validated but untyped; the parsing happens once, here. */
function toDate(value: unknown): Date | undefined {
  return typeof value === 'string' ? new Date(value) : undefined;
}

/**
 * GET /assignments
 *
 * `moduleId` is the documented filter. `learningPathId` and the rest are
 * additive: without either, a student gets the work across their own
 * curriculum, which is the "my assignments" screen and needs no second route.
 */
export const listAssignments = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const context = await contextFor(req);

  const learningPathId = req.query.learningPathId as string | undefined;
  const moduleId = req.query.moduleId as string | undefined;
  let learningPathIds: string[] | undefined;

  if (moduleId) {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { learningPathId: true },
    });
    if (!module) throw new AppError('Module not found', 404);
    await assertCanReadPath(user, module.learningPathId);
  } else if (learningPathId) {
    await assertCanReadPath(user, learningPathId);
  } else if (user.role !== 'ADMIN') {
    // Neither filter given. Narrow to every path this caller can reach — all of
    // them, not the first: an instructor teaching two stacks would otherwise
    // silently lose one, and silently is the problem.
    const readable = await resolveReadContext(user);
    learningPathIds = readable.learningPathIds ?? [];
    if (learningPathIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: { total: 0, page: 1, pageSize: 0, totalPages: 1, hasMore: false },
        message: 'You have not been assigned to a batch with a curriculum yet.',
      });
    }
  }

  const result = await AssignmentService.list(
    {
      moduleId,
      learningPathId,
      learningPathIds,
      batchId: req.query.batchId as string | undefined,
      q: req.query.q as string | undefined,
      status: req.query.status as 'draft' | 'published' | 'all' | undefined,
      dueBefore: toDate(req.query.dueBefore),
      dueAfter: toDate(req.query.dueAfter),
      sort: req.query.sort as 'deadline' | '-deadline' | 'createdAt' | '-createdAt' | undefined,
      page: req.query.page !== undefined ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined,
    },
    context
  );

  const { items, ...meta } = result;
  res.status(200).json({ success: true, data: items, meta });
});

export const getAssignment = asyncHandler(async (req: Request, res: Response) => {
  const context = await contextFor(req);
  const assignment = await AssignmentService.getById(req.params.id, context);
  await assertCanReadPath(req.user!, assignment.learningPathId);
  res.status(200).json({ success: true, data: assignment });
});

export const createAssignment = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  const assignment = await AssignmentService.create({
    moduleId: req.body.moduleId,
    title: req.body.title,
    description: req.body.description,
    maxMarks: req.body.maxMarks,
    deadline: new Date(req.body.deadline),
    scope: req.body.scope,
    batchId: req.body.batchId,
    allowResubmission: req.body.allowResubmission,
    isPublished: req.body.isPublished,
    createdById: req.user!.id,
  });

  res.status(201).json({
    success: true,
    data: assignment,
    message: assignment.isPublished
      ? 'Assignment published. Students have been notified.'
      : 'Assignment saved as a draft. Publish it when you are ready.',
  });
});

/**
 * PATCH /assignments/:id
 *
 * Edits are applied BEFORE the publication change, so a request that both
 * extends a deadline and publishes is judged against the new deadline rather
 * than the stale one it is replacing.
 */
export const updateAssignment = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  const { isPublished, deadline, ...fields } = req.body as {
    isPublished?: boolean;
    deadline?: string;
    title?: string;
    description?: string;
    maxMarks?: number;
    allowResubmission?: boolean;
  };

  let assignment = await AssignmentService.getByIdForWrite(req.params.id);

  const hasEdits = Object.keys(fields).length > 0 || deadline !== undefined;
  if (hasEdits) {
    assignment = await AssignmentService.update(req.params.id, {
      ...fields,
      ...(deadline !== undefined ? { deadline: new Date(deadline) } : {}),
    });
  }

  if (isPublished !== undefined && isPublished !== assignment.isPublished) {
    assignment = await AssignmentService.setPublished(req.params.id, isPublished, req.user!.id);
    return res.status(200).json({
      success: true,
      data: assignment,
      message: isPublished
        ? 'Assignment published. Students have been notified.'
        : 'Assignment withdrawn. Students can no longer see it.',
    });
  }

  res.status(200).json({ success: true, data: assignment });
});

export const deleteAssignment = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  await AssignmentService.remove(req.params.id);
  res.status(200).json({ success: true, message: 'Assignment deleted.' });
});
