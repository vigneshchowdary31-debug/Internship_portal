import type { Prisma } from '@prisma/client';
import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { quizVisibilityWhere, type VisibilityContext } from './visibility.service';
import { SUBMIT_GRACE_SECONDS } from './quiz.service';

/**
 * Quiz attempts — the student side of Module 3.
 *
 * The attempt is a two-step transaction against a clock:
 *
 *   start   → a row with `startedAt`, `expiresAt` and nothing else
 *   submit  → answers arrive, are marked, and `submittedAt` closes the row
 *
 * `submittedAt IS NULL` is therefore the definition of "open", and it is what
 * makes both "submitting without starting" and "submitting twice" detectable
 * without a status column that could disagree with the timestamps.
 *
 * `expiresAt` is pinned at start rather than recomputed from the quiz on every
 * read. An admin editing `Quiz.timeLimit` must not move the clock under a
 * student already running against it.
 */

const ATTEMPT_SELECT = {
  id: true,
  quizId: true,
  studentId: true,
  answers: true,
  score: true,
  totalMarks: true,
  startedAt: true,
  submittedAt: true,
  expiresAt: true,
  autoSubmitted: true,
  student: { select: { id: true, name: true, email: true, niatId: true } },
  quiz: { select: { id: true, title: true, timeLimit: true, moduleId: true } },
};

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** The student-safe question shape: no `correctAnswer`, ever. */
const QUESTION_SELECT_STUDENT = {
  id: true,
  question: true,
  options: true,
  marks: true,
  position: true,
};

export interface MarkedResult {
  score: number;
  totalMarks: number;
  correctCount: number;
  questionCount: number;
}

/**
 * Marks a set of answers against a question set.
 *
 * Pure and exported so the rule can be unit-tested without a database — the
 * arithmetic is the part a quiz system is judged on, and it should be provable
 * in isolation rather than only through a round trip.
 *
 * Three cases the spec calls out, all resolved the same conservative way:
 *
 *   - An answer for a question that is not on the paper is IGNORED. It cannot
 *     earn marks, and treating it as an error would let a malformed client
 *     invalidate an otherwise complete submission.
 *   - A missing answer is WRONG. Not answering is not a special state.
 *   - An answer that is not one of the question's options is WRONG. It is
 *     compared by value like any other, so it simply never matches.
 */
export function markAnswers(
  questions: { id: string; correctAnswer: string; marks: number }[],
  answers: Record<string, unknown>
): MarkedResult {
  let score = 0;
  let correctCount = 0;

  for (const question of questions) {
    const given = answers[question.id];
    // Strict equality on the string value. A non-string answer (number, object,
    // null from a client that sent a blank) can never equal correctAnswer, so
    // it lands as wrong without a special case.
    if (typeof given === 'string' && given === question.correctAnswer) {
      score += question.marks;
      correctCount++;
    }
  }

  return {
    score,
    totalMarks: questions.reduce((sum, q) => sum + q.marks, 0),
    correctCount,
    questionCount: questions.length,
  };
}

export class AttemptService {
  /**
   * Opens an attempt, or resumes the one already running.
   *
   * Resuming is deliberate: a student who reloads the page mid-quiz must not
   * burn an attempt, and must not get a fresh clock either. The existing row is
   * returned with its original `expiresAt`, so a reload costs nothing and buys
   * nothing.
   */
  static async start(quizId: string, studentId: string, context: VisibilityContext) {
    const quiz = await this.resolveAttemptableQuiz(quizId, context);

    if (quiz.questions.length === 0) {
      // Unreachable through the API — publishing an empty quiz is refused — but
      // a quiz emptied by other means would otherwise hand out a 0/0.
      throw new AppError('This quiz has no questions yet.', 409);
    }

    const now = new Date();

    const open = await prisma.attempt.findFirst({
      where: { quizId, studentId, submittedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (open) {
      if (open.expiresAt.getTime() > now.getTime()) {
        return {
          attempt: open,
          quiz: this.toStudentQuiz(quiz),
          resumed: true,
          secondsRemaining: secondsBetween(now, open.expiresAt),
        };
      }
      // Abandoned and expired. Close it at zero before letting them start
      // again, so it cannot sit open forever or be submitted later.
      await this.finalizeExpired(open.id, open.expiresAt, quiz.questions);
    }

    // Only COMPLETED attempts count against the cap: an abandoned attempt that
    // was just auto-closed above does count, which is the point — otherwise a
    // student could reset the clock indefinitely by walking away.
    if (quiz.maxAttempts !== null) {
      const used = await prisma.attempt.count({
        where: { quizId, studentId, submittedAt: { not: null } },
      });
      if (used >= quiz.maxAttempts) {
        throw new AppError(
          `You have used all ${quiz.maxAttempts} attempt(s) for this quiz.`,
          409
        );
      }
    }

    const expiresAt = new Date(now.getTime() + quiz.timeLimit * 60 * 1000);

    const attempt = await prisma.attempt.create({
      data: { quizId, studentId, startedAt: now, expiresAt },
    });

    return {
      attempt,
      quiz: this.toStudentQuiz(quiz),
      resumed: false,
      secondsRemaining: secondsBetween(now, expiresAt),
    };
  }

  /**
   * Marks and closes the student's open attempt.
   *
   * Late arrivals are REJECTED rather than marked, past a short grace window
   * for latency and clock skew. A timed quiz whose time limit is advisory is
   * not a timed quiz. The attempt is closed at zero in the same breath so it
   * cannot be retried until it happens to succeed.
   */
  static async submit(
    quizId: string,
    studentId: string,
    answers: Record<string, unknown>,
    context: VisibilityContext
  ) {
    const quiz = await this.resolveAttemptableQuiz(quizId, context);

    const open = await prisma.attempt.findFirst({
      where: { quizId, studentId, submittedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (!open) {
      // Either they never started, or they already submitted. Both are the same
      // client bug and the same message; distinguishing them would require
      // saying whether a previous attempt exists, which is not this endpoint's
      // business.
      throw new AppError(
        'You have no quiz in progress. Start the quiz before submitting answers.',
        409
      );
    }

    const now = new Date();
    const deadline = open.expiresAt.getTime() + SUBMIT_GRACE_SECONDS * 1000;

    if (now.getTime() > deadline) {
      await this.finalizeExpired(open.id, open.expiresAt, quiz.questions);
      throw new AppError(
        `Time is up for this attempt — the ${quiz.timeLimit} minute limit passed at ${open.expiresAt.toISOString()}. It has been closed and scored 0.`,
        409
      );
    }

    const result = markAnswers(quiz.questions, answers);

    const attempt = await prisma.attempt.update({
      where: { id: open.id },
      data: {
        answers: answers as Prisma.InputJsonValue,
        score: result.score,
        totalMarks: result.totalMarks,
        submittedAt: now,
      },
      select: ATTEMPT_SELECT,
    });

    return { attempt, result };
  }

  /**
   * Closes an abandoned attempt at its own expiry.
   *
   * `submittedAt` is set to `expiresAt`, not to now: the attempt ended when the
   * clock ran out, and stamping the moment the server happened to notice would
   * misreport it — sometimes by days, if nobody touched the quiz in between.
   */
  private static async finalizeExpired(
    attemptId: string,
    expiresAt: Date,
    questions: { id: string; correctAnswer: string; marks: number }[]
  ) {
    const result = markAnswers(questions, {});
    return prisma.attempt.update({
      where: { id: attemptId },
      data: {
        answers: {},
        score: result.score,
        totalMarks: result.totalMarks,
        submittedAt: expiresAt,
        autoSubmitted: true,
      },
    });
  }

  /**
   * The quiz a student is allowed to attempt, WITH its answer key.
   *
   * The key is loaded because marking happens here; it is stripped before
   * anything is returned to the caller (`toStudentQuiz`). Visibility is the
   * shared resolver, so unpublished, hidden-module and other-batch quizzes are
   * all "not found" — which covers "attempting an unpublished quiz" and
   * "attempting an invisible quiz" with one query rather than two checks that
   * could disagree.
   */
  private static async resolveAttemptableQuiz(quizId: string, context: VisibilityContext) {
    const quiz = await prisma.quiz.findFirst({
      where: { AND: [{ id: quizId }, quizVisibilityWhere(context)] },
      select: {
        id: true,
        title: true,
        description: true,
        timeLimit: true,
        maxAttempts: true,
        moduleId: true,
        questions: {
          select: { id: true, question: true, options: true, correctAnswer: true, marks: true, position: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!quiz) throw new AppError('Quiz not found', 404);
    return quiz;
  }

  /** Strips the answer key. The only shape a student ever receives. */
  private static toStudentQuiz(quiz: {
    id: string;
    title: string;
    description: string | null;
    timeLimit: number;
    maxAttempts: number | null;
    moduleId: string;
    questions: { id: string; question: string; options: unknown; marks: number; position: number }[];
  }) {
    return {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      timeLimit: quiz.timeLimit,
      maxAttempts: quiz.maxAttempts,
      moduleId: quiz.moduleId,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        marks: q.marks,
        position: q.position,
      })),
    };
  }

  // --- Reads ---------------------------------------------------------------

  /**
   * Attempts within the viewer's scope.
   *
   * `scope` arrives from the policy layer as a `where` fragment and is applied
   * in SQL — the same reason as submissions: filtering a fetched page in memory
   * hides rows but still counts them, so a student would learn how many
   * classmates had sat the quiz.
   */
  static async list(
    filters: { quizId?: string; studentId?: string; page?: number; pageSize?: number },
    scope: Prisma.AttemptWhereInput
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const conditions: Prisma.AttemptWhereInput[] = [scope];
    if (filters.quizId) conditions.push({ quizId: filters.quizId });
    if (filters.studentId) conditions.push({ studentId: filters.studentId });

    const where: Prisma.AttemptWhereInput = { AND: conditions };

    const [items, total] = await prisma.$transaction([
      prisma.attempt.findMany({
        where,
        select: ATTEMPT_SELECT,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.attempt.count({ where }),
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

  static async getById(id: string, scope: Prisma.AttemptWhereInput) {
    const attempt = await prisma.attempt.findFirst({
      where: { AND: [{ id }, scope] },
      select: ATTEMPT_SELECT,
    });
    if (!attempt) throw new AppError('Attempt not found', 404);
    return attempt;
  }
}

/** Whole seconds remaining, floored at zero. */
function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}
