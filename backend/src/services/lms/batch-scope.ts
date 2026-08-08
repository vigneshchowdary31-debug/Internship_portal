import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';

/**
 * "May this batch receive an item belonging to this learning path?"
 *
 * Lifted verbatim out of ContentService when assignments needed the same check
 * (Phase 3, M1). Behaviour and message are unchanged — this is an extraction,
 * not a rewrite — so that the rule has one home rather than one copy per
 * batch-scopable entity. ContentService now delegates here.
 *
 * A batch with no learning path yet (`learningPathId` null, legal since Phase 1)
 * is permitted: it is not running a *different* curriculum, it is running none,
 * and blocking it would make batch-scoped material impossible to prepare before
 * a cohort is wired up.
 */
export async function assertBatchOnPath(batchId: string, learningPathId: string): Promise<void> {
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
