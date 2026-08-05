import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';

/**
 * Versioned curricula.
 *
 * The clone operation is the point of this whole model: a new syllabus year is
 * a deep row copy, never a migration. Batches pin to a version, so publishing
 * "MERN 2027" leaves every cohort running "MERN 2026" completely undisturbed.
 */

export const LEARNING_PATH_SELECT = {
  id: true,
  techStackId: true,
  name: true,
  version: true,
  description: true,
  status: true,
  isDefault: true,
  clonedFromId: true,
  createdAt: true,
  updatedAt: true,
  techStack: { select: { id: true, name: true } },
  _count: { select: { modules: true, batches: true } },
};

export class LearningPathService {
  static async list(techStackId?: string) {
    return prisma.learningPath.findMany({
      where: techStackId ? { techStackId } : undefined,
      select: LEARNING_PATH_SELECT,
      orderBy: [{ techStackId: 'asc' }, { createdAt: 'desc' }],
    });
  }

  static async getById(id: string) {
    const path = await prisma.learningPath.findUnique({
      where: { id },
      select: LEARNING_PATH_SELECT,
    });
    if (!path) throw new AppError('Learning path not found', 404);
    return path;
  }

  static async create(data: {
    techStackId: string;
    name: string;
    version: string;
    description?: string;
    isDefault?: boolean;
    createdById: string;
  }) {
    const techStack = await prisma.techStack.findUnique({ where: { id: data.techStackId } });
    if (!techStack) throw new AppError('The selected tech stack does not exist', 400);

    const clash = await prisma.learningPath.findFirst({
      where: { techStackId: data.techStackId, version: data.version.trim() },
    });
    if (clash) {
      throw new AppError(
        `Version "${data.version}" already exists for ${techStack.name}. Pick a different version label.`,
        400
      );
    }

    return prisma.$transaction(async (tx) => {
      if (data.isDefault) await this.clearDefault(tx, data.techStackId);
      return tx.learningPath.create({
        data: {
          techStackId: data.techStackId,
          name: data.name.trim(),
          version: data.version.trim(),
          description: data.description?.trim() || null,
          isDefault: data.isDefault ?? false,
          createdById: data.createdById,
        },
        select: LEARNING_PATH_SELECT,
      });
    });
  }

  /** Only one default per tech stack; setting a new one clears the old. */
  private static async clearDefault(tx: any, techStackId: string, exceptId?: string) {
    await tx.learningPath.updateMany({
      where: { techStackId, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }

  static async update(
    id: string,
    data: { name?: string; version?: string; description?: string | null; isDefault?: boolean }
  ) {
    const existing = await prisma.learningPath.findUnique({ where: { id } });
    if (!existing) throw new AppError('Learning path not found', 404);

    if (data.version && data.version.trim() !== existing.version) {
      const clash = await prisma.learningPath.findFirst({
        where: { techStackId: existing.techStackId, version: data.version.trim(), NOT: { id } },
      });
      if (clash) throw new AppError(`Version "${data.version}" already exists for this tech stack.`, 400);
    }

    return prisma.$transaction(async (tx) => {
      if (data.isDefault) await this.clearDefault(tx, existing.techStackId, id);
      return tx.learningPath.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.version !== undefined ? { version: data.version.trim() } : {}),
          ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
          ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        },
        select: LEARNING_PATH_SELECT,
      });
    });
  }

  static async setStatus(id: string, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') {
    const existing = await prisma.learningPath.findUnique({
      where: { id },
      include: { _count: { select: { batches: true } } },
    });
    if (!existing) throw new AppError('Learning path not found', 404);

    if (status === 'ARCHIVED' && existing._count.batches > 0) {
      throw new AppError(
        `${existing._count.batches} batch(es) are running this path. Move them to another version before archiving it.`,
        400
      );
    }

    return prisma.learningPath.update({
      where: { id },
      data: { status },
      select: LEARNING_PATH_SELECT,
    });
  }

  /**
   * Deep-copies a path: modules, their prerequisite edges, and all content.
   *
   * `originId` is carried, not regenerated. That is what lets a transferred
   * student's completed work still count toward the equivalent module in the
   * new curriculum — two items are "the same thing in a different version" iff
   * they share an origin.
   *
   * Batch-scoped content is deliberately NOT copied: it belongs to a specific
   * cohort, and a fresh curriculum version starts with only the global
   * material. Admins re-add batch overrides where they still apply.
   */
  static async clone(
    sourceId: string,
    data: { name: string; version: string; description?: string; createdById: string }
  ) {
    const source = await prisma.learningPath.findUnique({
      where: { id: sourceId },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: {
            prerequisites: true,
            contents: {
              where: { scope: 'LEARNING_PATH' },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!source) throw new AppError('Learning path not found', 404);

    const clash = await prisma.learningPath.findFirst({
      where: { techStackId: source.techStackId, version: data.version.trim() },
    });
    if (clash) {
      throw new AppError(`Version "${data.version}" already exists for this tech stack.`, 400);
    }

    return prisma.$transaction(
      async (tx) => {
        const path = await tx.learningPath.create({
          data: {
            techStackId: source.techStackId,
            name: data.name.trim(),
            version: data.version.trim(),
            description: data.description?.trim() || source.description,
            status: 'DRAFT', // a clone is never live until an admin publishes it
            isDefault: false,
            clonedFromId: source.id,
            createdById: data.createdById,
          },
        });

        // Old module id → new module id, needed to remap prerequisite edges.
        const moduleIdMap = new Map<string, string>();

        for (const module of source.modules) {
          const created = await tx.module.create({
            data: {
              learningPathId: path.id,
              name: module.name,
              description: module.description,
              position: module.position,
              isVisible: module.isVisible,
              estimatedDurationMinutes: module.estimatedDurationMinutes,
              difficulty: module.difficulty,
              // Assets are shared across versions, never re-uploaded.
              thumbnailAssetId: module.thumbnailAssetId,
              // Lineage carried, never regenerated.
              originId: module.originId ?? module.id,
              aiMetadata: module.aiMetadata ?? undefined,
              createdById: data.createdById,
            },
          });
          moduleIdMap.set(module.id, created.id);

          if (module.contents.length > 0) {
            await tx.content.createMany({
              data: module.contents.map((content) => ({
                moduleId: created.id,
                learningPathId: path.id,
                title: content.title,
                description: content.description,
                type: content.type,
                status: content.status,
                position: content.position,
                scope: 'LEARNING_PATH' as const,
                batchId: null,
                releaseAt: content.releaseAt,
                assetId: content.assetId, // assets are shared, not re-uploaded
                externalUrl: content.externalUrl,
                originId: content.originId ?? content.id,
                version: content.version,
                createdById: data.createdById,
              })),
            });
          }
        }

        // Prerequisite edges, remapped into the new module ids. Edges pointing
        // outside the cloned set are dropped rather than left dangling.
        const edges = source.modules.flatMap((module) =>
          module.prerequisites
            .map((edge) => ({
              moduleId: moduleIdMap.get(edge.moduleId),
              prerequisiteId: moduleIdMap.get(edge.prerequisiteId),
            }))
            .filter((e): e is { moduleId: string; prerequisiteId: string } =>
              Boolean(e.moduleId && e.prerequisiteId)
            )
        );
        if (edges.length > 0) {
          await tx.modulePrerequisite.createMany({ data: edges, skipDuplicates: true });
        }

        return tx.learningPath.findUnique({ where: { id: path.id }, select: LEARNING_PATH_SELECT });
      },
      // A large curriculum can exceed the 5s default.
      { timeout: 30_000 }
    );
  }

  static async remove(id: string) {
    const path = await prisma.learningPath.findUnique({
      where: { id },
      include: { _count: { select: { batches: true } } },
    });
    if (!path) throw new AppError('Learning path not found', 404);

    // Also enforced by onDelete: Restrict — this produces the readable message.
    if (path._count.batches > 0) {
      throw new AppError(
        `Cannot delete "${path.name}": ${path._count.batches} batch(es) are running it. Move them to another version first.`,
        400
      );
    }

    await prisma.learningPath.delete({ where: { id } });
    return true;
  }
}
