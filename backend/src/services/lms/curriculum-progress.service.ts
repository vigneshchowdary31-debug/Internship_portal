import prisma from '../../config/db';
import {
  assignmentVisibilityWhere,
  contentVisibilityWhere,
  quizVisibilityWhere,
  type VisibilityContext,
} from './visibility.service';

/**
 * Progress roll-ups over ContentProgress.
 *
 * Deliberately DERIVED, never stored. A cached `percent` column would need
 * invalidating every time content is published, released, overridden for a
 * batch, or cloned into a new version — and the first missed invalidation
 * shows a student a wrong number they cannot refresh away.
 *
 * The denominator is the set of items that student can actually SEE, resolved
 * through the shared visibility builder. Counting hidden drafts or another
 * batch's overrides would make 100% unreachable, which is the more common bug
 * than the arithmetic itself.
 *
 * This does not replace StudentProgress, which tracks per-tech-stack standing
 * for the existing reporting screens. The two answer different questions.
 */

export interface ModuleProgress {
  moduleId: string;
  total: number;
  completed: number;
  percent: number;
}

export class CurriculumProgressService {
  /**
   * Per-module progress for one student across a learning path.
   *
   * Two grouped queries regardless of module count — the obvious
   * implementation runs one pair per module and is the N+1 this screen would
   * otherwise ship with.
   */
  static async forLearningPath(
    studentId: string,
    learningPathId: string,
    context: VisibilityContext
  ): Promise<{ modules: ModuleProgress[]; overall: ModuleProgress }> {
    const visible = contentVisibilityWhere(context);

    // Denominator: visible items per module.
    const totals = await prisma.content.groupBy({
      by: ['moduleId'],
      where: { AND: [{ learningPathId }, visible] },
      _count: { _all: true },
      orderBy: { moduleId: 'asc' },
    });

    const moduleIds = totals.map((t) => t.moduleId);
    if (moduleIds.length === 0) {
      return { modules: [], overall: { moduleId: 'ALL', total: 0, completed: 0, percent: 0 } };
    }

    // Numerator: completed items, restricted to the SAME visible set so a
    // student who completed an item that later became hidden cannot exceed 100%.
    const completedRows = await prisma.content.groupBy({
      by: ['moduleId'],
      where: {
        AND: [
          { learningPathId },
          visible,
          { progress: { some: { studentId, completedAt: { not: null } } } },
        ],
      },
      _count: { _all: true },
      orderBy: { moduleId: 'asc' },
    });

    const completedByModule = new Map(completedRows.map((r) => [r.moduleId, r._count._all]));

    const modules: ModuleProgress[] = totals.map((t) => {
      const total = t._count._all;
      const completed = completedByModule.get(t.moduleId) ?? 0;
      return { moduleId: t.moduleId, total, completed, percent: toPercent(completed, total) };
    });

    const total = modules.reduce((sum, m) => sum + m.total, 0);
    const completed = modules.reduce((sum, m) => sum + m.completed, 0);

    return {
      modules,
      // Recomputed from the summed counts, NOT averaged from the per-module
      // percentages — averaging weights a 1-item module the same as a 40-item
      // one and quietly overstates progress.
      overall: { moduleId: 'ALL', total, completed, percent: toPercent(completed, total) },
    };
  }

  /**
   * Batch-wide completion, for the instructor curriculum view.
   *
   * Counts distinct students with at least one completion per module, which is
   * the number an instructor reads as "who has started/finished this".
   */
  static async forBatch(batchId: string, learningPathId: string, context: VisibilityContext) {
    const [studentCount, perModule] = await Promise.all([
      prisma.studentBatch.count({ where: { batchId } }),
      prisma.contentProgress.groupBy({
        by: ['contentId'],
        where: {
          completedAt: { not: null },
          content: { AND: [{ learningPathId }, contentVisibilityWhere(context)] },
          student: { studentBatches: { some: { batchId } } },
        },
        _count: { _all: true },
        orderBy: { contentId: 'asc' },
      }),
    ]);

    const completionsByContent = new Map(perModule.map((r) => [r.contentId, r._count._all]));

    const contents = await prisma.content.findMany({
      where: { AND: [{ learningPathId }, contentVisibilityWhere(context)] },
      select: { id: true, moduleId: true, title: true },
    });

    const byModule = new Map<string, { moduleId: string; items: { contentId: string; title: string; completedBy: number }[] }>();
    for (const c of contents) {
      if (!byModule.has(c.moduleId)) byModule.set(c.moduleId, { moduleId: c.moduleId, items: [] });
      byModule.get(c.moduleId)!.items.push({
        contentId: c.id,
        title: c.title,
        completedBy: completionsByContent.get(c.id) ?? 0,
      });
    }

    return { studentCount, modules: [...byModule.values()] };
  }

  /**
   * Assignment progress for one student across a learning path (Phase 3, M2).
   *
   * DERIVED, like everything else here — and it needs no write path at all,
   * because the Submission row IS the progress record. "Update progress when an
   * assignment is submitted" is satisfied by there being nothing to update: the
   * next read counts the new row. A stored counter would need invalidating
   * every time an assignment is published, withdrawn, made batch-specific or
   * moved into a hidden module, and the first missed invalidation shows a
   * student a number they cannot refresh away.
   *
   * Returned ALONGSIDE content progress, never folded into it. Merging the two
   * would silently move the percentage every existing Phase 1/2 screen displays.
   *
   * The denominator is the assignments this student can actually SEE, resolved
   * through the shared visibility builder — counting drafts or another batch's
   * work would put 100% out of reach.
   */
  static async assignmentsForLearningPath(
    studentId: string,
    learningPathId: string,
    context: VisibilityContext
  ): Promise<{ total: number; submitted: number; late: number; graded: number; percent: number; averageScorePercent: number | null }> {
    const visible = assignmentVisibilityWhere(context);
    const where = { AND: [{ learningPathId }, visible] };

    const [total, submissions] = await Promise.all([
      prisma.assignment.count({ where }),
      prisma.submission.findMany({
        where: { studentId, assignment: where },
        select: {
          isLate: true,
          marks: true,
          assignment: { select: { maxMarks: true } },
        },
      }),
    ]);

    const submitted = submissions.length;
    const late = submissions.filter((s) => s.isLate).length;
    const marked = submissions.filter((s) => s.marks !== null);

    // Averaged as a percentage of each assignment's own maximum, not as raw
    // marks: a 10-mark quiz and a 100-mark project are not comparable totals,
    // and summing them weights the project ten times heavier by accident.
    const averageScorePercent =
      marked.length === 0
        ? null
        : Math.round(
            marked.reduce((sum, s) => sum + (s.marks! / s.assignment.maxMarks) * 100, 0) /
              marked.length
          );

    return {
      total,
      submitted,
      late,
      graded: marked.length,
      percent: toPercent(submitted, total),
      averageScorePercent,
    };
  }

  /**
   * Quiz progress for one student across a learning path (Phase 3, M3).
   *
   * DERIVED from the Attempt table, exactly like assignment progress is derived
   * from Submission — there is no write path and nothing to invalidate, because
   * the Attempt row IS the record of completion.
   *
   * A quiz counts as attempted once the student has any CLOSED attempt on it
   * (`submittedAt` non-null). An open attempt is someone mid-quiz, not someone
   * who has done it, and counting it would let a student reach 100% by opening
   * every quiz and walking away.
   *
   * The best score is used where a quiz allows several attempts. Averaging
   * attempts would punish a student for practising, which is the opposite of
   * what re-attempts are offered for.
   */
  static async quizzesForLearningPath(
    studentId: string,
    learningPathId: string,
    context: VisibilityContext
  ): Promise<{
    total: number;
    attempted: number;
    percent: number;
    averageScorePercent: number | null;
  }> {
    const visible = quizVisibilityWhere(context);
    const where = { AND: [{ learningPathId }, visible] };

    const [total, attempts] = await Promise.all([
      prisma.quiz.count({ where }),
      prisma.attempt.findMany({
        where: { studentId, submittedAt: { not: null }, quiz: where },
        select: { quizId: true, score: true, totalMarks: true },
      }),
    ]);

    // Best percentage per quiz, then averaged across quizzes — not a mean over
    // all attempts, which would weight a heavily-retried quiz more than a
    // one-shot one.
    const bestByQuiz = new Map<string, number>();
    for (const a of attempts) {
      if (a.score === null || !a.totalMarks) continue;
      const percent = (a.score / a.totalMarks) * 100;
      const current = bestByQuiz.get(a.quizId);
      if (current === undefined || percent > current) bestByQuiz.set(a.quizId, percent);
    }

    const attempted = new Set(attempts.map((a) => a.quizId)).size;
    const scored = [...bestByQuiz.values()];

    return {
      total,
      attempted,
      percent: toPercent(attempted, total),
      averageScorePercent:
        scored.length === 0
          ? null
          : Math.round(scored.reduce((sum, p) => sum + p, 0) / scored.length),
    };
  }

  /**
   * The "Continue Learning" target: the most recently touched item that is
   * still incomplete.
   */
  static async resumePoint(studentId: string, context: VisibilityContext) {
    return prisma.contentProgress.findFirst({
      where: {
        studentId,
        completedAt: null,
        content: contentVisibilityWhere(context),
      },
      orderBy: { lastViewedAt: 'desc' },
      select: {
        lastViewedAt: true,
        content: {
          select: { id: true, title: true, type: true, moduleId: true, module: { select: { name: true } } },
        },
      },
    });
  }
}

/** Rounded to a whole number — a progress bar has no use for more precision. */
function toPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}
