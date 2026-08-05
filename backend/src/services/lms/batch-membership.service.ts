import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { EnrollmentHistoryService } from '../enrollment-history.service';

/**
 * Batch membership under the one-batch-per-student rule.
 *
 * `StudentBatch` carries UNIQUE(studentId), so assigning a student who already
 * belongs to another batch is a MOVE, not an insert. Doing it any other way
 * produces a unique-violation and a confusing 500.
 *
 * ── What a transfer does and does not touch ───────────────────────────────
 * A transfer moves ONE row. Every historical record is immutable and survives
 * untouched, because none of them reference StudentBatch:
 *
 *   Attendance        → FKs Session + User
 *   ContentProgress   → FKs Content + User
 *   StudentProgress   → FKs TechStack + User   (instructor's manual rating)
 *   EnrollmentEvent   → FKs User               (append-only)
 *   Submissions       → FKs Activity + User    (Phase 2)
 *
 * Only forward-looking visibility follows the new batch: which sessions they
 * attend, and which batch-scoped content and overrides they see.
 *
 * ── Completion after a cross-path transfer ────────────────────────────────
 * If the new batch runs a DIFFERENT learning path, completion is recomputed
 * against the new curriculum. Work on modules common to both paths still counts
 * — `Module.originId` / `Content.originId` are carried across clones, so
 * equivalent items resolve to the same lineage. Only genuinely new modules read
 * as incomplete. Nothing is deleted.
 */

export interface TransferPreview {
  isMove: boolean;
  currentBatch: { id: string; name: string; learningPathId: string | null } | null;
  targetBatch: { id: string; name: string; learningPathId: string | null };
  /** True when the two batches run different curricula. */
  crossesLearningPath: boolean;
  /** Modules in the target path with no lineage equivalent in the current one. */
  newModuleCount: number;
  /** Modules present in both, whose completed work carries over. */
  retainedModuleCount: number;
}

export class BatchMembershipService {
  /**
   * Explains what an assignment would do, before it does it.
   *
   * The admin sees whether this is a move, which batch the student is leaving,
   * and — critically — whether their completion percentage is about to change
   * because the curriculum differs. Surfacing that beforehand is the difference
   * between an informed decision and a surprise.
   */
  static async previewAssignment(studentId: string, targetBatchId: string): Promise<TransferPreview> {
    const [student, existing, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: studentId }, select: { id: true, role: true } }),
      prisma.studentBatch.findFirst({
        where: { studentId },
        select: { batch: { select: { id: true, name: true, learningPathId: true } } },
      }),
      prisma.batch.findUnique({
        where: { id: targetBatchId },
        select: { id: true, name: true, learningPathId: true },
      }),
    ]);

    if (!student) throw new AppError('Student not found', 404);
    if (student.role !== 'STUDENT') throw new AppError('Only students can be assigned to a batch.', 400);
    if (!target) throw new AppError('Batch not found', 404);

    const current = existing?.batch ?? null;
    const crossesLearningPath = Boolean(
      current?.learningPathId && target.learningPathId && current.learningPathId !== target.learningPathId
    );

    let newModuleCount = 0;
    let retainedModuleCount = 0;

    if (crossesLearningPath && current?.learningPathId && target.learningPathId) {
      const [currentModules, targetModules] = await Promise.all([
        prisma.module.findMany({
          where: { learningPathId: current.learningPathId },
          select: { id: true, originId: true },
        }),
        prisma.module.findMany({
          where: { learningPathId: target.learningPathId },
          select: { id: true, originId: true },
        }),
      ]);

      // Lineage roots, not ids: a cloned module is "the same module" as its
      // source even though its id differs.
      const currentOrigins = new Set(currentModules.map((m) => m.originId ?? m.id));
      for (const module of targetModules) {
        if (currentOrigins.has(module.originId ?? module.id)) retainedModuleCount++;
        else newModuleCount++;
      }
    }

    return {
      isMove: Boolean(current && current.id !== target.id),
      currentBatch: current,
      targetBatch: target,
      crossesLearningPath,
      newModuleCount,
      retainedModuleCount,
    };
  }

  /**
   * Assigns or moves one student. Idempotent when already in the target batch.
   *
   * The delete + create runs in a single transaction so the unique constraint
   * can never observe the student in two batches.
   */
  static async assign(studentId: string, targetBatchId: string, actorId: string) {
    const preview = await this.previewAssignment(studentId, targetBatchId);

    if (preview.currentBatch?.id === targetBatchId) {
      return { moved: false, preview };
    }

    await prisma.$transaction([
      prisma.studentBatch.deleteMany({ where: { studentId } }),
      prisma.studentBatch.create({
        data: { studentId, batchId: targetBatchId, assignedAt: new Date() },
      }),
    ]);

    await EnrollmentHistoryService.record({
      userId: studentId,
      type: preview.isMove ? 'BATCH_TRANSFERRED' : 'BATCH_ASSIGNED',
      detail: preview.isMove
        ? `Moved from "${preview.currentBatch!.name}" to "${preview.targetBatch.name}"` +
          (preview.crossesLearningPath
            ? ` — different learning path; ${preview.retainedModuleCount} module(s) carried over, ${preview.newModuleCount} newly introduced`
            : '')
        : `Assigned to "${preview.targetBatch.name}"`,
      actorId,
    });

    return { moved: preview.isMove, preview };
  }

  /**
   * Replaces a batch's entire student roster.
   *
   * Backward-compatible replacement for the old delete-all-then-recreate on
   * `POST /batches/:id/students`. It still replaces the roster, but students
   * arriving from another batch are moved rather than rejected, and every
   * change is audited.
   */
  static async setBatchRoster(batchId: string, studentIds: string[], actorId: string) {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, name: true },
    });
    if (!batch) throw new AppError('Batch not found', 404);

    const unique = [...new Set(studentIds)];

    if (unique.length > 0) {
      const found = await prisma.user.findMany({
        where: { id: { in: unique }, role: 'STUDENT' },
        select: { id: true },
      });
      if (found.length !== unique.length) {
        throw new AppError('One or more selected users are not students.', 400);
      }
    }

    const currentRoster = await prisma.studentBatch.findMany({
      where: { batchId },
      select: { studentId: true },
    });
    const currentIds = new Set(currentRoster.map((r) => r.studentId));
    const targetIds = new Set(unique);

    const removed = [...currentIds].filter((id) => !targetIds.has(id));
    const added = unique.filter((id) => !currentIds.has(id));

    // Removals first, so a student moving between two batches in one operation
    // never transiently violates the unique constraint.
    if (removed.length > 0) {
      await prisma.studentBatch.deleteMany({ where: { batchId, studentId: { in: removed } } });
    }

    // Sequential rather than parallel: each addition may be a move that needs
    // its own delete-then-create transaction, and a preview lookup for audit.
    const results = [];
    for (const studentId of added) {
      results.push(await this.assign(studentId, batchId, actorId));
    }

    await EnrollmentHistoryService.recordMany(
      removed.map((studentId) => ({
        userId: studentId,
        type: 'BATCH_REMOVED' as const,
        detail: `Removed from "${batch.name}"`,
        actorId,
      }))
    );

    return {
      added: added.length,
      removed: removed.length,
      moved: results.filter((r) => r.moved).length,
      unchanged: unique.length - added.length,
    };
  }

  /** The single batch a student belongs to, with its learning path. */
  static async getStudentBatch(studentId: string) {
    const row = await prisma.studentBatch.findFirst({
      where: { studentId },
      select: {
        assignedAt: true,
        batch: {
          select: {
            id: true,
            name: true,
            learningPathId: true,
            techStackId: true,
            learningPath: { select: { id: true, name: true, version: true } },
            techStack: { select: { id: true, name: true } },
          },
        },
      },
    });
    return row;
  }
}
