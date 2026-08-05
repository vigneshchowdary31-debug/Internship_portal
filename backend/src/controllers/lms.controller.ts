import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { LearningPathService } from '../services/lms/learning-path.service';
import { ModuleService } from '../services/lms/module.service';
import { ContentService } from '../services/lms/content.service';
import { BatchMembershipService } from '../services/lms/batch-membership.service';
import { SearchService } from '../services/lms/search.service';
import { NotificationService } from '../services/lms/notification.service';
import { CurriculumProgressService } from '../services/lms/curriculum-progress.service';
import { StorageService } from '../services/storage/storage.service';
import {
  assertCanAccessBatch,
  assertCanWriteCurriculum,
  resolveReadContext,
} from '../policies/lms.policy';
import prisma from '../config/db';
import type { VisibilityContext } from '../services/lms/visibility.service';

/**
 * Builds the visibility context for the current request.
 *
 * Admins and instructors see drafts and unreleased items because they author
 * and review them; students never do. The batch whose overrides apply is the
 * student's own, or — for an instructor — one they explicitly asked for and are
 * assigned to.
 */
async function buildVisibilityContext(req: Request): Promise<VisibilityContext> {
  const user = req.user!;
  const requestedBatchId = (req.query.batchId as string | undefined) || undefined;

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
 * Students may only read curriculum belonging to the path their batch runs.
 * Returning 403 rather than an empty list keeps the boundary unambiguous.
 */
async function assertCanReadPath(req: Request, learningPathId: string): Promise<void> {
  const user = req.user!;
  if (user.role === 'ADMIN') return;

  const context = await resolveReadContext(user);
  if (!context.learningPathIds || context.learningPathIds.includes(learningPathId)) return;

  throw new AppError('You do not have access to this curriculum.', 403);
}

// --- Learning paths ---------------------------------------------------------

export const listLearningPaths = asyncHandler(async (req: Request, res: Response) => {
  const techStackId = req.query.techStackId as string | undefined;
  let paths = await LearningPathService.list(techStackId);

  // Non-admins only ever see the paths their batches run.
  if (req.user!.role !== 'ADMIN') {
    const context = await resolveReadContext(req.user!);
    const allowed = new Set(context.learningPathIds ?? []);
    paths = paths.filter((p) => allowed.has(p.id));
  }

  res.status(200).json({ success: true, data: paths });
});

export const getLearningPath = asyncHandler(async (req: Request, res: Response) => {
  await assertCanReadPath(req, req.params.id);
  res.status(200).json({ success: true, data: await LearningPathService.getById(req.params.id) });
});

export const createLearningPath = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  const path = await LearningPathService.create({ ...req.body, createdById: req.user!.id });
  res.status(201).json({ success: true, data: path, message: 'Learning path created.' });
});

export const updateLearningPath = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res
    .status(200)
    .json({ success: true, data: await LearningPathService.update(req.params.id, req.body) });
});

export const cloneLearningPath = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  const path = await LearningPathService.clone(req.params.id, {
    ...req.body,
    createdById: req.user!.id,
  });
  res.status(201).json({
    success: true,
    data: path,
    message: 'Curriculum cloned. It starts as a draft — publish it when ready.',
  });
});

export const setLearningPathStatus = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({
    success: true,
    data: await LearningPathService.setStatus(req.params.id, req.body.status),
  });
});

export const deleteLearningPath = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  await LearningPathService.remove(req.params.id);
  res.status(200).json({ success: true, message: 'Learning path deleted.' });
});

// --- Modules ----------------------------------------------------------------

export const listModules = asyncHandler(async (req: Request, res: Response) => {
  await assertCanReadPath(req, req.params.id);
  const includeHidden = req.user!.role !== 'STUDENT';
  res
    .status(200)
    .json({ success: true, data: await ModuleService.listForPath(req.params.id, includeHidden) });
});

export const createModule = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  const module = await ModuleService.create({
    learningPathId: req.params.id,
    ...req.body,
    createdById: req.user!.id,
  });
  res.status(201).json({ success: true, data: module, message: 'Module created.' });
});

export const updateModule = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({ success: true, data: await ModuleService.update(req.params.id, req.body) });
});

export const reorderModules = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({
    success: true,
    data: await ModuleService.reorder(req.params.id, req.body.orderedIds),
  });
});

export const setModulePrerequisites = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({
    success: true,
    data: await ModuleService.setPrerequisites(req.params.id, req.body.moduleIds),
  });
});

export const deleteModule = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  await ModuleService.remove(req.params.id);
  res.status(200).json({ success: true, message: 'Module deleted.' });
});

// --- Content ----------------------------------------------------------------

export const listContents = asyncHandler(async (req: Request, res: Response) => {
  const module = await prisma.module.findUnique({
    where: { id: req.params.id },
    select: { learningPathId: true },
  });
  if (!module) throw new AppError('Module not found', 404);

  await assertCanReadPath(req, module.learningPathId);
  const context = await buildVisibilityContext(req);

  // Paginated only when the client asks. Omitting the params keeps the original
  // array response, so every existing caller — including the Phase 1 curriculum
  // builder — keeps working unchanged.
  const { page, pageSize } = readPagination(req);
  if (page === undefined && pageSize === undefined) {
    return res
      .status(200)
      .json({ success: true, data: await ContentService.listForModule(req.params.id, context) });
  }

  const result = await ContentService.listForModulePaged(req.params.id, context, { page, pageSize });
  res.status(200).json({ success: true, data: result.items, meta: stripItems(result) });
});

export const createContent = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  const content = await ContentService.create({
    moduleId: req.params.id,
    ...req.body,
    releaseAt: req.body.releaseAt ? new Date(req.body.releaseAt) : null,
    createdById: req.user!.id,
  });
  res.status(201).json({ success: true, data: content, message: 'Content added.' });
});

export const updateContent = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  const content = await ContentService.update(req.params.id, {
    ...req.body,
    ...(req.body.releaseAt !== undefined
      ? { releaseAt: req.body.releaseAt ? new Date(req.body.releaseAt) : null }
      : {}),
    updatedById: req.user!.id,
  });
  res.status(200).json({ success: true, data: content });
});

export const setContentStatus = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({
    success: true,
    data: await ContentService.setStatus(req.params.id, req.body.status, req.user!.id),
  });
});

export const createContentOverride = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  const content = await ContentService.createOverride(req.params.id, {
    ...req.body,
    createdById: req.user!.id,
  });
  res.status(201).json({
    success: true,
    data: content,
    message: 'Batch override created. The original remains untouched for other batches.',
  });
});

export const reorderContents = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({
    success: true,
    data: await ContentService.reorder(req.params.id, req.body.orderedIds),
  });
});

export const deleteContent = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  await ContentService.remove(req.params.id);
  res.status(200).json({ success: true, message: 'Content deleted.' });
});

/** Student interaction tracking. The kind is derived from the route. */
const makeInteractionHandler = (kind: 'view' | 'download' | 'open') =>
  asyncHandler(async (req: Request, res: Response) => {
    const progress = await ContentService.recordInteraction(req.user!.id, req.params.id, kind);
    res.status(200).json({ success: true, data: progress });
  });

export const recordContentView = makeInteractionHandler('view');
export const recordContentDownload = makeInteractionHandler('download');
export const recordContentOpen = makeInteractionHandler('open');

export const markContentComplete = asyncHandler(async (req: Request, res: Response) => {
  const progress = await ContentService.markComplete(req.user!.id, req.params.id);
  res.status(200).json({ success: true, data: progress });
});

// --- Uploads ----------------------------------------------------------------

export const signUpload = asyncHandler(async (req: Request, res: Response) => {
  // Students may upload submission artifacts (Phase 2); only admins upload
  // curriculum content.
  if (req.body.purpose === 'content') assertCanWriteCurriculum(req.user!);
  res.status(200).json({ success: true, data: await StorageService.createSignedUpload(req.body) });
});

export const confirmUpload = asyncHandler(async (req: Request, res: Response) => {
  if (req.body.purpose === 'content') assertCanWriteCurriculum(req.user!);
  const asset = await StorageService.confirmUpload({ ...req.body, uploadedById: req.user!.id });
  res.status(201).json({ success: true, data: asset });
});

// --- Student's own curriculum ----------------------------------------------

/**
 * Everything a student needs to render their course in one round trip:
 * their batch, its learning path, and the visible modules.
 */
export const getMyCurriculum = asyncHandler(async (req: Request, res: Response) => {
  const membership = await BatchMembershipService.getStudentBatch(req.user!.id);

  if (!membership?.batch.learningPathId) {
    return res.status(200).json({
      success: true,
      data: { batch: membership?.batch ?? null, learningPath: null, modules: [] },
      message: membership
        ? 'Your batch has no curriculum assigned yet.'
        : 'You have not been assigned to a batch yet.',
    });
  }

  // Scheduled items that have reached their release moment are announced here,
  // on the first read after the moment passes. This is what keeps the "no cron"
  // rule while still notifying students: the release itself is already lazy, so
  // the announcement is too. Failure is logged, never surfaced — a student
  // loading their course must not see an error because a mail server blinked.
  try {
    await NotificationService.announceDueReleases(membership.batch.learningPathId);
  } catch (error: any) {
    console.error('[lms] Announcing due releases failed:', error?.message || error);
  }

  const [modules, progress] = await Promise.all([
    ModuleService.listForPath(membership.batch.learningPathId, false),
    CurriculumProgressService.forLearningPath(req.user!.id, membership.batch.learningPathId, {
      batchId: membership.batch.id,
      includeUnpublished: false,
    }),
  ]);

  // Progress is merged onto each module here rather than fetched per card by
  // the client — one round trip, and no N+1 from the browser.
  const progressByModule = new Map(progress.modules.map((m) => [m.moduleId, m]));

  res.status(200).json({
    success: true,
    data: {
      batch: membership.batch,
      learningPath: membership.batch.learningPath,
      modules: modules.map((m) => ({
        ...m,
        progress: progressByModule.get(m.id) ?? { total: 0, completed: 0, percent: 0 },
      })),
      progress: progress.overall,
    },
  });
});

// --- Batch membership -------------------------------------------------------

export const previewStudentAssignment = asyncHandler(async (req: Request, res: Response) => {
  const preview = await BatchMembershipService.previewAssignment(
    req.body.studentId,
    req.params.id
  );
  res.status(200).json({ success: true, data: preview });
});

export const assignStudentToBatch = asyncHandler(async (req: Request, res: Response) => {
  const result = await BatchMembershipService.assign(req.body.studentId, req.params.id, req.user!.id);
  res.status(200).json({
    success: true,
    data: result,
    message: result.moved
      ? `Student moved to "${result.preview.targetBatch.name}".`
      : `Student assigned to "${result.preview.targetBatch.name}".`,
  });
});


// ---------------------------------------------------------------------------
// Phase 2 — search, notifications, progress
// ---------------------------------------------------------------------------

/**
 * Query-string pagination. `validate` checks these but does not coerce them
 * back onto the request, so the numbers are parsed here rather than trusted.
 */
function readPagination(req: Request): { page?: number; pageSize?: number } {
  const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
  const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined;
  return {
    page: Number.isFinite(page) ? page : undefined,
    pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
  };
}

/** Pagination envelope without the payload, for the `meta` field. */
function stripItems<T extends { items: unknown }>(result: T): Omit<T, 'items'> {
  const { items: _items, ...meta } = result;
  return meta;
}

/**
 * Content search.
 *
 * Runs inside the caller's visibility context — a student searching only ever
 * matches published, released, in-scope material, and never learns that a
 * draft exists by finding zero results for a title they were told about.
 */
export const searchContent = asyncHandler(async (req: Request, res: Response) => {
  const context = await buildVisibilityContext(req);
  const { page, pageSize } = readPagination(req);

  const result = await SearchService.searchContent(
    {
      q: req.query.q as string | undefined,
      learningPathId: req.query.learningPathId as string | undefined,
      moduleId: req.query.moduleId as string | undefined,
      type: req.query.type as string | undefined,
      status: req.query.status as string | undefined,
      scope: req.query.scope as 'LEARNING_PATH' | 'BATCH' | undefined,
      batchId: req.query.batchId as string | undefined,
      page,
      pageSize,
    },
    context
  );

  res.status(200).json({ success: true, data: result.items, meta: stripItems(result) });
});

export const contentFacets = asyncHandler(async (req: Request, res: Response) => {
  const context = await buildVisibilityContext(req);
  const facets = await SearchService.facets(
    {
      learningPathId: req.query.learningPathId as string | undefined,
      moduleId: req.query.moduleId as string | undefined,
    },
    context
  );
  res.status(200).json({ success: true, data: facets });
});

// --- Notifications ----------------------------------------------------------

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = readPagination(req);
  const result = await NotificationService.listForUser(req.user!.id, {
    unreadOnly: req.query.unreadOnly === 'true',
    page,
    pageSize,
  });
  res.status(200).json({ success: true, data: result.items, meta: stripItems(result) });
});

export const notificationUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  res
    .status(200)
    .json({ success: true, data: { unread: await NotificationService.unreadCount(req.user!.id) } });
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  await NotificationService.markRead(req.user!.id, req.params.id);
  res.status(200).json({ success: true, message: 'Notification marked as read.' });
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const count = await NotificationService.markAllRead(req.user!.id);
  res.status(200).json({ success: true, data: { updated: count } });
});

// --- Progress ---------------------------------------------------------------

/** The signed-in student's progress across a learning path. */
export const getMyProgress = asyncHandler(async (req: Request, res: Response) => {
  const context = await buildVisibilityContext(req);
  const progress = await CurriculumProgressService.forLearningPath(
    req.user!.id,
    req.params.id,
    context
  );
  res.status(200).json({ success: true, data: progress });
});

export const getMyResumePoint = asyncHandler(async (req: Request, res: Response) => {
  const context = await buildVisibilityContext(req);
  const resume = await CurriculumProgressService.resumePoint(req.user!.id, context);
  res.status(200).json({ success: true, data: resume });
});

/**
 * Batch-wide progress for an instructor or admin.
 *
 * Students are excluded outright: this exposes every classmate's completion
 * state, which is a different privacy question from seeing one's own progress.
 */
export const getBatchProgress = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.role === 'STUDENT') {
    throw new AppError('Batch progress is only available to instructors and administrators.', 403);
  }
  await assertCanAccessBatch(user, req.params.id);

  const batch = await prisma.batch.findUnique({
    where: { id: req.params.id },
    select: { learningPathId: true },
  });
  if (!batch?.learningPathId) {
    return res.status(200).json({ success: true, data: { studentCount: 0, modules: [] } });
  }

  const progress = await CurriculumProgressService.forBatch(req.params.id, batch.learningPathId, {
    batchId: req.params.id,
    includeUnpublished: false,
  });
  res.status(200).json({ success: true, data: progress });
});
