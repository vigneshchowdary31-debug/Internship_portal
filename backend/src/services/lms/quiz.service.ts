import type { Prisma } from '@prisma/client';
import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { assertBatchOnPath } from './batch-scope';
import { quizVisibilityWhere, type VisibilityContext } from './visibility.service';
import { NotificationService } from './notification.service';

/**
 * Quizzes — timed, auto-marked MCQ assessments.
 *
 * Two rules dominate this file, and both are about what NOT to expose:
 *
 *   1. Every read goes through `quizVisibilityWhere`, the shared resolver. A
 *      draft, a quiz in a hidden module and another batch's quiz are all
 *      equally "not found" — the same answer, carrying no information about
 *      which of the three it was.
 *
 *   2. `Question.correctAnswer` NEVER reaches a student. It is excluded by
 *      `QUESTION_SELECT_STUDENT` and the two selects are kept adjacent so the
 *      difference between them is visible at a glance rather than buried in a
 *      query. Leaking it does not expose one row; it hands out the answer key.
 */

const QUESTION_SELECT_AUTHOR = {
  id: true,
  quizId: true,
  question: true,
  options: true,
  correctAnswer: true,
  marks: true,
  position: true,
};

/** The SAME fields minus `correctAnswer`. Never widen this without cause. */
const QUESTION_SELECT_STUDENT = {
  id: true,
  quizId: true,
  question: true,
  options: true,
  marks: true,
  position: true,
};

const QUIZ_BASE_SELECT = {
  id: true,
  moduleId: true,
  learningPathId: true,
  title: true,
  description: true,
  timeLimit: true,
  isPublished: true,
  publishedAt: true,
  scope: true,
  batchId: true,
  maxAttempts: true,
  createdAt: true,
  updatedAt: true,
  module: { select: { id: true, name: true, isVisible: true } },
  batch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { questions: true, attempts: true } },
};

export const QUIZ_SELECT_AUTHOR = {
  ...QUIZ_BASE_SELECT,
  questions: { select: QUESTION_SELECT_AUTHOR, orderBy: { position: 'asc' } },
} satisfies Prisma.QuizSelect;

export const QUIZ_SELECT_STUDENT = {
  ...QUIZ_BASE_SELECT,
  questions: { select: QUESTION_SELECT_STUDENT, orderBy: { position: 'asc' } },
} satisfies Prisma.QuizSelect;

/** Listing never carries questions — a list of 30 quizzes does not need them. */
export const QUIZ_SELECT_LIST = QUIZ_BASE_SELECT;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Latitude on the timer, in seconds.
 *
 * A submission is rejected once the limit plus this window has passed. The
 * window exists for network latency and clock skew between the student's
 * browser and the server — the only legitimate reasons a client that fired at
 * the right moment arrives late. It is deliberately short: anything longer is
 * extra exam time granted by accident.
 */
export const SUBMIT_GRACE_SECONDS = 30;

export interface QuizFilters {
  moduleId?: string;
  learningPathId?: string;
  learningPathIds?: string[];
  batchId?: string;
  q?: string;
  status?: 'draft' | 'published' | 'all';
  page?: number;
  pageSize?: number;
}

export class QuizService {
  // --- Reads ---------------------------------------------------------------

  static async list(filters: QuizFilters, context: VisibilityContext) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const conditions: Prisma.QuizWhereInput[] = [quizVisibilityWhere(context)];

    if (filters.moduleId) conditions.push({ moduleId: filters.moduleId });
    if (filters.learningPathId) conditions.push({ learningPathId: filters.learningPathId });
    if (filters.learningPathIds) {
      conditions.push({ learningPathId: { in: filters.learningPathIds } });
    }
    if (filters.batchId) conditions.push({ batchId: filters.batchId });

    const term = filters.q?.trim();
    if (term) {
      conditions.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (filters.status === 'published') conditions.push({ isPublished: true });
    if (filters.status === 'draft') conditions.push({ isPublished: false });

    const where: Prisma.QuizWhereInput = { AND: conditions };

    const [items, total] = await prisma.$transaction([
      prisma.quiz.findMany({
        where,
        select: QUIZ_SELECT_LIST,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.quiz.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
    };
  }

  /**
   * One quiz, resolved inside the caller's visibility.
   *
   * `includeAnswers` follows the caller's authority, not a parameter they can
   * ask for: the controller derives it from `context.includeUnpublished`, which
   * is only ever true for an admin or instructor.
   */
  static async getById(id: string, context: VisibilityContext) {
    const quiz = await prisma.quiz.findFirst({
      where: { AND: [{ id }, quizVisibilityWhere(context)] },
      select: context.includeUnpublished ? QUIZ_SELECT_AUTHOR : QUIZ_SELECT_STUDENT,
    });
    if (!quiz) throw new AppError('Quiz not found', 404);
    return quiz;
  }

  /** Unfiltered read for write paths, which have already been authorized. */
  private static async requireById(id: string) {
    const quiz = await prisma.quiz.findUnique({
      where: { id },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
    if (!quiz) throw new AppError('Quiz not found', 404);
    return quiz;
  }

  static async getByIdForWrite(id: string) {
    await this.requireById(id);
    return prisma.quiz.findUniqueOrThrow({ where: { id }, select: QUIZ_SELECT_AUTHOR });
  }

  // --- Authoring -----------------------------------------------------------

  static async create(data: {
    moduleId: string;
    title: string;
    description?: string | null;
    timeLimit: number;
    maxAttempts?: number | null;
    scope?: 'LEARNING_PATH' | 'BATCH';
    batchId?: string | null;
    createdById: string;
  }) {
    const module = await prisma.module.findUnique({
      where: { id: data.moduleId },
      select: { id: true, learningPathId: true },
    });
    if (!module) throw new AppError('Module not found', 404);

    const scope = data.scope ?? 'LEARNING_PATH';
    if (scope === 'BATCH') {
      if (!data.batchId) throw new AppError('A batch is required for batch-scoped quizzes.', 400);
      await assertBatchOnPath(data.batchId, module.learningPathId);
    }

    // Always a draft. A quiz with no questions cannot be published (see
    // setPublished), so there is no useful "create and publish" shortcut the
    // way there is for an assignment.
    return prisma.quiz.create({
      data: {
        moduleId: data.moduleId,
        learningPathId: module.learningPathId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        timeLimit: data.timeLimit,
        /**
         * ONE attempt unless the author says otherwise.
         *
         * Previously an omitted `maxAttempts` meant unlimited, which is the
         * wrong default for an assessment: a quiz someone can retake freely
         * measures persistence, not knowledge, and an author who wanted that
         * would say so. The three states stay distinguishable —
         *   omitted      -> 1  (this default)
         *   explicit N   -> N
         *   explicit null-> unlimited, a deliberate choice
         * — so "unlimited" remains available without being what you get by
         * forgetting to decide.
         */
        maxAttempts: data.maxAttempts === undefined ? 1 : data.maxAttempts,
        scope,
        batchId: scope === 'BATCH' ? data.batchId : null,
        createdById: data.createdById,
      },
      select: QUIZ_SELECT_AUTHOR,
    });
  }

  static async update(
    id: string,
    data: {
      title?: string;
      description?: string | null;
      timeLimit?: number;
      maxAttempts?: number | null;
    }
  ) {
    await this.requireById(id);

    return prisma.quiz.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() || null }
          : {}),
        ...(data.timeLimit !== undefined ? { timeLimit: data.timeLimit } : {}),
        ...(data.maxAttempts !== undefined ? { maxAttempts: data.maxAttempts } : {}),
      },
      select: QUIZ_SELECT_AUTHOR,
    });
  }

  /**
   * Publishes or withdraws a quiz.
   *
   * A quiz with no questions cannot be published: a student who opens it would
   * see an empty paper and score 0/0, and the notification would have announced
   * nothing. Refusing here is the only point at which that is still cheap to
   * fix.
   *
   * The notification fires only on a real false -> true transition, matching
   * assignments and content. Its failure never fails the publish: the quiz IS
   * live at that point, and reporting an error invites a retry that
   * double-notifies.
   */
  static async setPublished(id: string, isPublished: boolean, actorId: string | null = null) {
    const existing = await this.requireById(id);

    if (isPublished && existing._count.questions === 0) {
      throw new AppError(
        'This quiz has no questions yet. Add at least one before publishing it.',
        400
      );
    }

    const updated = await prisma.quiz.update({
      where: { id },
      data: {
        isPublished,
        // Stamped once. Withdrawing and re-publishing keeps the original date,
        // so "when was this set" stays truthful.
        ...(isPublished && !existing.publishedAt ? { publishedAt: new Date() } : {}),
      },
      select: QUIZ_SELECT_AUTHOR,
    });

    if (isPublished && !existing.isPublished) {
      try {
        await NotificationService.announceQuizPublished(id, actorId);
      } catch (error: any) {
        console.error(
          `[lms] Quiz ${id} published, but notifying students failed:`,
          error?.message || error
        );
      }
    }

    return updated;
  }

  static async remove(id: string) {
    const quiz = await this.requireById(id);

    // Attempts cascade. Deleting a quiz students have already sat would erase
    // their results silently, which is a surprising amount of destruction from
    // one click — the same guard ModuleService applies to populated modules.
    if (quiz._count.attempts > 0) {
      throw new AppError(
        `"${quiz.title}" has ${quiz._count.attempts} student attempt(s) and cannot be deleted. Withdraw it instead.`,
        400
      );
    }

    await prisma.quiz.delete({ where: { id } });
    return true;
  }

  // --- Questions -----------------------------------------------------------

  /**
   * Validates one question's shape.
   *
   * `correctAnswer` must be one of the options — the single check that stops an
   * auto-marked quiz where nobody can score. A typo here is invisible until the
   * first student submits and every answer is marked wrong.
   */
  private static assertQuestionShape(options: unknown, correctAnswer: string) {
    if (!Array.isArray(options)) {
      throw new AppError('Options must be a list of choices.', 400);
    }
    if (options.length < 2) {
      throw new AppError('A question needs at least two options.', 400);
    }
    if (options.length > 10) {
      throw new AppError('A question can have at most ten options.', 400);
    }
    if (!options.every((o) => typeof o === 'string' && o.trim().length > 0)) {
      throw new AppError('Every option must be a non-empty string.', 400);
    }
    if (new Set(options).size !== options.length) {
      throw new AppError('Options must be distinct.', 400);
    }
    if (!options.includes(correctAnswer)) {
      throw new AppError('The correct answer must be one of the options.', 400);
    }
  }

  /**
   * The question set is frozen once anyone has attempted the quiz.
   *
   * `Attempt.score` and `Attempt.totalMarks` are recorded against the questions
   * as they stood at submission. Editing a `correctAnswer` afterwards would
   * leave stored scores that no longer follow from the quiz — marks that cannot
   * be explained or reproduced. Withdrawing the quiz does not help either; the
   * attempts still exist. The way to change a sat quiz is to make a new one.
   */
  private static async assertQuestionsEditable(quizId: string) {
    const attempts = await prisma.attempt.count({ where: { quizId } });
    if (attempts > 0) {
      throw new AppError(
        `This quiz has already been attempted ${attempts} time(s), so its questions can no longer be changed. Create a new quiz instead.`,
        409
      );
    }
  }

  static async addQuestion(
    quizId: string,
    data: { question: string; options: string[]; correctAnswer: string; marks?: number }
  ) {
    await this.requireById(quizId);
    await this.assertQuestionsEditable(quizId);
    this.assertQuestionShape(data.options, data.correctAnswer);

    const last = await prisma.question.findFirst({
      where: { quizId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return prisma.question.create({
      data: {
        quizId,
        question: data.question.trim(),
        options: data.options,
        correctAnswer: data.correctAnswer,
        marks: data.marks ?? 1,
        position: (last?.position ?? -1) + 1,
      },
      select: QUESTION_SELECT_AUTHOR,
    });
  }

  static async updateQuestion(
    quizId: string,
    questionId: string,
    data: { question?: string; options?: string[]; correctAnswer?: string; marks?: number }
  ) {
    const existing = await prisma.question.findFirst({
      where: { id: questionId, quizId },
      select: { id: true, options: true, correctAnswer: true },
    });
    if (!existing) throw new AppError('Question not found', 404);

    await this.assertQuestionsEditable(quizId);

    // Validated against the MERGED result, not the incoming fields alone:
    // changing only `correctAnswer` must still be checked against the stored
    // options, and replacing only `options` must still contain the stored
    // answer. Checking each in isolation lets exactly those two edits through.
    const options = data.options ?? (existing.options as string[]);
    const correctAnswer = data.correctAnswer ?? existing.correctAnswer;
    this.assertQuestionShape(options, correctAnswer);

    return prisma.question.update({
      where: { id: questionId },
      data: {
        ...(data.question !== undefined ? { question: data.question.trim() } : {}),
        ...(data.options !== undefined ? { options: data.options } : {}),
        ...(data.correctAnswer !== undefined ? { correctAnswer: data.correctAnswer } : {}),
        ...(data.marks !== undefined ? { marks: data.marks } : {}),
      },
      select: QUESTION_SELECT_AUTHOR,
    });
  }

  static async removeQuestion(quizId: string, questionId: string) {
    const existing = await prisma.question.findFirst({
      where: { id: questionId, quizId },
      select: { id: true },
    });
    if (!existing) throw new AppError('Question not found', 404);

    await this.assertQuestionsEditable(quizId);

    await prisma.question.delete({ where: { id: questionId } });
    return true;
  }
}
