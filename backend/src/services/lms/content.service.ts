import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { assertValidReorder, nextPosition, toPositionUpdates } from './ordering.service';
import { contentVisibilityWhere, type VisibilityContext } from './visibility.service';
import { NotificationService } from './notification.service';

export const CONTENT_SELECT = {
  id: true,
  moduleId: true,
  learningPathId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  position: true,
  scope: true,
  batchId: true,
  overridesId: true,
  releaseAt: true,
  externalUrl: true,
  originId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  asset: {
    select: { id: true, url: true, originalFilename: true, mimeType: true, sizeBytes: true },
  },
  batch: { select: { id: true, name: true } },
  overriddenBy: { select: { id: true, batchId: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
};

/** Which payload field each content type requires. */
const ASSET_TYPES = ['PDF', 'PPT', 'DOCX', 'VIDEO'];
const URL_TYPES = ['GITHUB_REPO', 'RECORDING', 'LINK'];
/**
 * Reference material is the one type that accepts EITHER a file or a link — a
 * reading list mixes uploaded papers and external articles, and forcing one or
 * the other would mean two content types for one concept.
 */
const EITHER_TYPES = ['REFERENCE'];

export class ContentService {
  /**
   * Every content read goes through the shared visibility resolver.
   * No caller filters for correctness itself.
   */
  static async listForModule(moduleId: string, context: VisibilityContext) {
    return prisma.content.findMany({
      where: { moduleId, ...contentVisibilityWhere(context) },
      select: CONTENT_SELECT,
      orderBy: { position: 'asc' },
    });
  }

  /**
   * Paginated variant for modules large enough that returning everything is
   * wasteful. Ordering stays by `position` so a page boundary never reshuffles
   * the curriculum the way an `updatedAt` sort would.
   */
  static async listForModulePaged(
    moduleId: string,
    context: VisibilityContext,
    options: { page?: number; pageSize?: number } = {}
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
    const where = { moduleId, ...contentVisibilityWhere(context) };

    const [items, total] = await prisma.$transaction([
      prisma.content.findMany({
        where,
        select: CONTENT_SELECT,
        orderBy: { position: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.content.count({ where }),
    ]);

    return { items, total, page, pageSize, hasMore: page * pageSize < total };
  }

  static async getById(id: string) {
    const content = await prisma.content.findUnique({ where: { id }, select: CONTENT_SELECT });
    if (!content) throw new AppError('Content not found', 404);
    return content;
  }

  /** A content item must carry exactly the payload its type implies. */
  private static assertPayload(type: string, assetId?: string | null, externalUrl?: string | null) {
    if (ASSET_TYPES.includes(type) && !assetId) {
      throw new AppError(`A ${type} item requires an uploaded file.`, 400);
    }
    if (URL_TYPES.includes(type) && !externalUrl?.trim()) {
      throw new AppError(`A ${type} item requires a URL.`, 400);
    }
    if (EITHER_TYPES.includes(type) && !assetId && !externalUrl?.trim()) {
      throw new AppError('Reference material needs either an uploaded file or a URL.', 400);
    }
  }

  static async create(data: {
    moduleId: string;
    title: string;
    description?: string;
    type: string;
    assetId?: string | null;
    externalUrl?: string | null;
    releaseAt?: Date | null;
    scope?: 'LEARNING_PATH' | 'BATCH';
    batchId?: string | null;
    createdById: string;
  }) {
    const module = await prisma.module.findUnique({
      where: { id: data.moduleId },
      select: { id: true, learningPathId: true },
    });
    if (!module) throw new AppError('Module not found', 404);

    this.assertPayload(data.type, data.assetId, data.externalUrl);

    const scope = data.scope ?? 'LEARNING_PATH';
    if (scope === 'BATCH') {
      if (!data.batchId) throw new AppError('A batch is required for batch-scoped content.', 400);
      await this.assertBatchOnPath(data.batchId, module.learningPathId);
    }

    const last = await prisma.content.findFirst({
      where: { moduleId: data.moduleId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await prisma.content.create({
      data: {
        moduleId: data.moduleId,
        learningPathId: module.learningPathId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        type: data.type as any,
        assetId: data.assetId || null,
        externalUrl: data.externalUrl?.trim() || null,
        releaseAt: data.releaseAt ?? null,
        scope,
        batchId: scope === 'BATCH' ? data.batchId : null,
        position: nextPosition(last?.position),
        createdById: data.createdById,
      },
    });

    return prisma.content.update({
      where: { id: created.id },
      data: { originId: created.id },
      select: CONTENT_SELECT,
    });
  }

  /** A batch may only receive content from the path it is actually running. */
  private static async assertBatchOnPath(batchId: string, learningPathId: string) {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, name: true, learningPathId: true },
    });
    if (!batch) throw new AppError('Batch not found', 400);
    if (batch.learningPathId && batch.learningPathId !== learningPathId) {
      throw new AppError(
        `"${batch.name}" is running a different learning path, so it cannot receive this content.`,
        400
      );
    }
  }

  static async update(
    id: string,
    data: {
      title?: string;
      description?: string | null;
      assetId?: string | null;
      externalUrl?: string | null;
      releaseAt?: Date | null;
      updatedById: string;
    }
  ) {
    const existing = await prisma.content.findUnique({ where: { id } });
    if (!existing) throw new AppError('Content not found', 404);

    const assetId = data.assetId !== undefined ? data.assetId : existing.assetId;
    const externalUrl = data.externalUrl !== undefined ? data.externalUrl : existing.externalUrl;
    this.assertPayload(existing.type, assetId, externalUrl);

    return prisma.content.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.assetId !== undefined ? { assetId: data.assetId } : {}),
        ...(data.externalUrl !== undefined ? { externalUrl: data.externalUrl?.trim() || null } : {}),
        ...(data.releaseAt !== undefined ? { releaseAt: data.releaseAt } : {}),
        updatedById: data.updatedById,
        // Bumped so a client can tell a replaced file from an edited title.
        version: { increment: 1 },
      },
      select: CONTENT_SELECT,
    });
  }

  /**
   * Changes publication state, announcing the item when it first goes live.
   *
   * The notification fires only on a real DRAFT/ARCHIVED -> PUBLISHED
   * transition. Re-publishing an already-published item (a no-op save, or a
   * status set as part of an edit) must not re-notify a batch — students
   * receiving the same "new material" alert twice is the fastest way to train
   * them to ignore notifications entirely.
   *
   * Announcement failure never fails the publish: the content IS live at that
   * point, and reporting an error would invite the admin to retry and
   * double-notify.
   */
  static async setStatus(
    id: string,
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
    actorId: string | null = null
  ) {
    const existing = await prisma.content.findUnique({ where: { id } });
    if (!existing) throw new AppError('Content not found', 404);

    const updated = await prisma.content.update({
      where: { id },
      data: { status },
      select: CONTENT_SELECT,
    });

    const newlyPublished = status === 'PUBLISHED' && existing.status !== 'PUBLISHED';
    if (newlyPublished) {
      try {
        await NotificationService.announceContentPublished(id, actorId);
      } catch (error: any) {
        console.error(
          `[lms] Content ${id} published, but notifying students failed:`,
          error?.message || error
        );
      }
    }

    return updated;
  }

  /**
   * Creates a batch-scoped item that REPLACES a global one for that batch.
   *
   * The global item is never mutated, so removing the override restores the
   * original for that batch by deleting exactly one row.
   */
  static async createOverride(
    globalContentId: string,
    data: {
      batchId: string;
      title?: string;
      description?: string;
      assetId?: string | null;
      externalUrl?: string | null;
      createdById: string;
    }
  ) {
    const original = await prisma.content.findUnique({
      where: { id: globalContentId },
      include: { overriddenBy: true },
    });
    if (!original) throw new AppError('Content not found', 404);

    if (original.scope !== 'LEARNING_PATH') {
      throw new AppError('Only learning-path content can be overridden.', 400);
    }

    // overridesId is @unique, so a second override would fail at the database.
    // Catching it here gives a message that explains the situation.
    if (original.overriddenBy) {
      throw new AppError(
        'This item is already overridden. Edit or remove the existing override instead.',
        400
      );
    }

    await this.assertBatchOnPath(data.batchId, original.learningPathId);

    const assetId = data.assetId !== undefined ? data.assetId : original.assetId;
    const externalUrl = data.externalUrl !== undefined ? data.externalUrl : original.externalUrl;
    this.assertPayload(original.type, assetId, externalUrl);

    const created = await prisma.content.create({
      data: {
        moduleId: original.moduleId,
        learningPathId: original.learningPathId,
        title: (data.title ?? original.title).trim(),
        description: data.description?.trim() ?? original.description,
        type: original.type,
        status: original.status,
        position: original.position,
        scope: 'BATCH',
        batchId: data.batchId,
        overridesId: original.id,
        releaseAt: original.releaseAt,
        assetId,
        externalUrl,
        createdById: data.createdById,
      },
    });

    return prisma.content.update({
      where: { id: created.id },
      data: { originId: created.id },
      select: CONTENT_SELECT,
    });
  }

  static async reorder(moduleId: string, orderedIds: string[]) {
    const existing = await prisma.content.findMany({
      where: { moduleId },
      select: { id: true },
    });

    assertValidReorder(orderedIds, existing.map((c) => c.id));
    const updates = toPositionUpdates(orderedIds);

    await prisma.$transaction([
      ...updates.map((u, index) =>
        prisma.content.update({ where: { id: u.id }, data: { position: -1 - index } })
      ),
      ...updates.map((u) =>
        prisma.content.update({ where: { id: u.id }, data: { position: u.position } })
      ),
    ]);

    return prisma.content.findMany({
      where: { moduleId },
      select: CONTENT_SELECT,
      orderBy: { position: 'asc' },
    });
  }

  static async remove(id: string) {
    const content = await prisma.content.findUnique({ where: { id } });
    if (!content) throw new AppError('Content not found', 404);
    await prisma.content.delete({ where: { id } });
    return true;
  }

  /**
   * Records a student interaction and returns the updated counters.
   *
   * `view` also stamps `lastViewedAt`, which is what the Continue Learning
   * widget resumes from. Downloads and external opens are counted separately so
   * "most downloaded PDF" and "most opened recording" stay distinguishable.
   */
  static async recordInteraction(
    studentId: string,
    contentId: string,
    kind: 'view' | 'download' | 'open'
  ) {
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true },
    });
    if (!content) throw new AppError('Content not found', 404);

    const now = new Date();
    return prisma.contentProgress.upsert({
      where: { studentId_contentId: { studentId, contentId } },
      create: {
        studentId,
        contentId,
        viewCount: kind === 'view' ? 1 : 0,
        downloadCount: kind === 'download' ? 1 : 0,
        openCount: kind === 'open' ? 1 : 0,
        firstViewedAt: now,
        lastViewedAt: now,
      },
      update: {
        ...(kind === 'view' ? { viewCount: { increment: 1 } } : {}),
        ...(kind === 'download' ? { downloadCount: { increment: 1 } } : {}),
        ...(kind === 'open' ? { openCount: { increment: 1 } } : {}),
        lastViewedAt: now,
      },
    });
  }

  /**
   * Marks an item complete. Idempotent — re-completing keeps the first
   * timestamp, so "when did they finish this" stays truthful.
   */
  static async markComplete(studentId: string, contentId: string) {
    const now = new Date();
    return prisma.contentProgress.upsert({
      where: { studentId_contentId: { studentId, contentId } },
      create: {
        studentId,
        contentId,
        viewCount: 1,
        firstViewedAt: now,
        lastViewedAt: now,
        completedAt: now,
      },
      update: { completedAt: now, lastViewedAt: now },
    });
  }
}
