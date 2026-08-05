import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { assertValidReorder, nextPosition, toPositionUpdates } from './ordering.service';

export const MODULE_SELECT = {
  id: true,
  learningPathId: true,
  name: true,
  description: true,
  position: true,
  isVisible: true,
  estimatedDurationMinutes: true,
  difficulty: true,
  thumbnailAssetId: true,
  thumbnail: { select: { id: true, url: true, originalFilename: true } },
  originId: true,
  createdAt: true,
  updatedAt: true,
  prerequisites: {
    select: { prerequisite: { select: { id: true, name: true } } },
  },
  _count: { select: { contents: true } },
};

export class ModuleService {
  static async listForPath(learningPathId: string, includeHidden: boolean) {
    return prisma.module.findMany({
      where: { learningPathId, ...(includeHidden ? {} : { isVisible: true }) },
      select: MODULE_SELECT,
      orderBy: { position: 'asc' },
    });
  }

  static async getById(id: string) {
    const module = await prisma.module.findUnique({ where: { id }, select: MODULE_SELECT });
    if (!module) throw new AppError('Module not found', 404);
    return module;
  }

  static async create(data: {
    learningPathId: string;
    name: string;
    description?: string;
    estimatedDurationMinutes?: number;
    difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    thumbnailAssetId?: string | null;
    createdById: string;
  }) {
    const path = await prisma.learningPath.findUnique({ where: { id: data.learningPathId } });
    if (!path) throw new AppError('Learning path not found', 404);

    const last = await prisma.module.findFirst({
      where: { learningPathId: data.learningPathId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await prisma.module.create({
      data: {
        learningPathId: data.learningPathId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        estimatedDurationMinutes: data.estimatedDurationMinutes ?? null,
        difficulty: data.difficulty ?? null,
        thumbnailAssetId: data.thumbnailAssetId ?? null,
        position: nextPosition(last?.position),
        createdById: data.createdById,
      },
    });

    // A brand-new module is its own lineage root. Clones carry this forward,
    // which is what makes cross-version equivalence resolvable.
    return prisma.module.update({
      where: { id: created.id },
      data: { originId: created.id },
      select: MODULE_SELECT,
    });
  }

  static async update(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      isVisible?: boolean;
      estimatedDurationMinutes?: number | null;
      difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null;
      /** null clears the thumbnail; undefined leaves it untouched. */
      thumbnailAssetId?: string | null;
    }
  ) {
    const existing = await prisma.module.findUnique({ where: { id } });
    if (!existing) throw new AppError('Module not found', 404);

    return prisma.module.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.isVisible !== undefined ? { isVisible: data.isVisible } : {}),
        ...(data.estimatedDurationMinutes !== undefined
          ? { estimatedDurationMinutes: data.estimatedDurationMinutes }
          : {}),
        ...(data.difficulty !== undefined ? { difficulty: data.difficulty } : {}),
        ...(data.thumbnailAssetId !== undefined ? { thumbnailAssetId: data.thumbnailAssetId } : {}),
      },
      select: MODULE_SELECT,
    });
  }

  /**
   * Rewrites the whole ordering in one transaction.
   *
   * Positions are shifted out of range first. Without that, an in-place swap
   * transiently collides on any unique ordering constraint and the transaction
   * aborts — a classic reorder bug that only shows up on a real swap.
   */
  static async reorder(learningPathId: string, orderedIds: string[]) {
    const existing = await prisma.module.findMany({
      where: { learningPathId },
      select: { id: true },
    });

    assertValidReorder(orderedIds, existing.map((m) => m.id));

    const updates = toPositionUpdates(orderedIds);

    await prisma.$transaction([
      ...updates.map((u, index) =>
        prisma.module.update({ where: { id: u.id }, data: { position: -1 - index } })
      ),
      ...updates.map((u) =>
        prisma.module.update({ where: { id: u.id }, data: { position: u.position } })
      ),
    ]);

    return this.listForPath(learningPathId, true);
  }

  /**
   * Replaces a module's prerequisite set.
   *
   * Metadata only — nothing gates access on it (approved decision 7). Self- and
   * duplicate references are rejected because they are always mistakes, and a
   * self-edge would render as "React requires React".
   */
  static async setPrerequisites(moduleId: string, prerequisiteIds: string[]) {
    const module = await prisma.module.findUnique({ where: { id: moduleId } });
    if (!module) throw new AppError('Module not found', 404);

    const unique = [...new Set(prerequisiteIds)];

    if (unique.includes(moduleId)) {
      throw new AppError('A module cannot be its own prerequisite.', 400);
    }

    if (unique.length > 0) {
      const found = await prisma.module.findMany({
        where: { id: { in: unique }, learningPathId: module.learningPathId },
        select: { id: true },
      });
      if (found.length !== unique.length) {
        throw new AppError(
          'Prerequisites must be modules from the same learning path.',
          400
        );
      }
    }

    await prisma.$transaction([
      prisma.modulePrerequisite.deleteMany({ where: { moduleId } }),
      ...(unique.length > 0
        ? [
            prisma.modulePrerequisite.createMany({
              data: unique.map((prerequisiteId) => ({ moduleId, prerequisiteId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return this.getById(moduleId);
  }

  static async remove(id: string) {
    const module = await prisma.module.findUnique({
      where: { id },
      include: { _count: { select: { contents: true } } },
    });
    if (!module) throw new AppError('Module not found', 404);

    // Content cascades. Deleting a populated module silently would be a
    // surprising amount of destruction from one click.
    if (module._count.contents > 0) {
      throw new AppError(
        `"${module.name}" still contains ${module._count.contents} item(s). Delete or move them first.`,
        400
      );
    }

    await prisma.module.delete({ where: { id } });
    return true;
  }
}
