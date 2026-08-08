import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/db';
import { QuizService } from '../services/lms/quiz.service';
import { AttemptService } from '../services/lms/attempt.service';
import { QuestionImportService } from '../services/lms/question-import.service';
import {
  assertCanReadPath,
  assertCanSubmit,
  assertCanWriteCurriculum,
  buildVisibilityContext,
  resolveReadContext,
  studentWorkScopeFor,
} from '../policies/lms.policy';

/**
 * Quizzes and attempts (Phase 3, M3).
 *
 * Authorization reuses the LMS policy layer unchanged: `assertCanWriteCurriculum`
 * for authoring (admin), `assertCanSubmit` for attempting (student),
 * `studentWorkScopeFor` for reading attempts (admin all / instructor own
 * batches / student own). No quiz-specific rule is introduced.
 */

function contextFor(req: Request) {
  return buildVisibilityContext(req.user!, (req.query.batchId as string | undefined) || undefined);
}

// --- Authoring ---------------------------------------------------------------

export const createQuiz = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  const quiz = await QuizService.create({
    moduleId: req.body.moduleId,
    title: req.body.title,
    description: req.body.description,
    timeLimit: req.body.timeLimit,
    maxAttempts: req.body.maxAttempts,
    scope: req.body.scope,
    batchId: req.body.batchId,
    createdById: req.user!.id,
  });

  res.status(201).json({
    success: true,
    data: quiz,
    message: 'Quiz created as a draft. Add questions, then publish it.',
  });
});

/**
 * PATCH /quizzes/:id
 *
 * Field edits are applied BEFORE the publication change, matching the
 * assignment path — so a request that both fixes the time limit and publishes
 * is judged against the corrected value.
 */
export const updateQuiz = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  const { isPublished, ...fields } = req.body as {
    isPublished?: boolean;
    title?: string;
    description?: string | null;
    timeLimit?: number;
    maxAttempts?: number | null;
  };

  let quiz = await QuizService.getByIdForWrite(req.params.id);

  if (Object.keys(fields).length > 0) {
    quiz = await QuizService.update(req.params.id, fields);
  }

  if (isPublished !== undefined && isPublished !== quiz.isPublished) {
    quiz = await QuizService.setPublished(req.params.id, isPublished, req.user!.id);
    return res.status(200).json({
      success: true,
      data: quiz,
      message: isPublished
        ? 'Quiz published. Students have been notified.'
        : 'Quiz withdrawn. Students can no longer see it.',
    });
  }

  res.status(200).json({ success: true, data: quiz });
});

export const deleteQuiz = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  await QuizService.remove(req.params.id);
  res.status(200).json({ success: true, message: 'Quiz deleted.' });
});

// --- Questions ---------------------------------------------------------------

export const addQuestion = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  const question = await QuizService.addQuestion(req.params.id, {
    question: req.body.question,
    options: req.body.options,
    correctAnswer: req.body.correctAnswer,
    marks: req.body.marks,
  });

  res.status(201).json({ success: true, data: question, message: 'Question added.' });
});

export const updateQuestion = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  res.status(200).json({
    success: true,
    data: await QuizService.updateQuestion(req.params.id, req.params.questionId, req.body),
  });
});

export const deleteQuestion = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);
  await QuizService.removeQuestion(req.params.id, req.params.questionId);
  res.status(200).json({ success: true, message: 'Question removed.' });
});

// --- Reads -------------------------------------------------------------------

export const listQuizzes = asyncHandler(async (req: Request, res: Response) => {
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

  const result = await QuizService.list(
    {
      moduleId,
      learningPathId,
      learningPathIds,
      batchId: req.query.batchId as string | undefined,
      q: req.query.q as string | undefined,
      status: req.query.status as 'draft' | 'published' | 'all' | undefined,
      page: req.query.page !== undefined ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined,
    },
    context
  );

  const { items, ...meta } = result;
  res.status(200).json({ success: true, data: items, meta });
});

/**
 * GET /quizzes/:id
 *
 * Whether the answer key is included follows the CONTEXT, not a query
 * parameter: `includeUnpublished` is true only for an admin or instructor, and
 * QuizService picks its select from it. A student cannot ask for the key.
 */
export const getQuiz = asyncHandler(async (req: Request, res: Response) => {
  const context = await contextFor(req);
  const quiz = await QuizService.getById(req.params.id, context);
  await assertCanReadPath(req.user!, quiz.learningPathId);
  res.status(200).json({ success: true, data: quiz });
});

// --- Attempts ----------------------------------------------------------------

export const startAttempt = asyncHandler(async (req: Request, res: Response) => {
  assertCanSubmit(req.user!);

  // A student's own context — so an unpublished quiz, one in a hidden module,
  // and another batch's quiz are all equally "not found".
  const context = await buildVisibilityContext(req.user!);
  const result = await AttemptService.start(req.params.id, req.user!.id, context);

  res.status(result.resumed ? 200 : 201).json({
    success: true,
    data: result,
    message: result.resumed
      ? 'Resumed your attempt already in progress. The clock did not restart.'
      : 'Attempt started. The clock is running.',
  });
});

export const submitAttempt = asyncHandler(async (req: Request, res: Response) => {
  assertCanSubmit(req.user!);

  const context = await buildVisibilityContext(req.user!);
  const { attempt, result } = await AttemptService.submit(
    req.params.id,
    req.user!.id,
    req.body.answers,
    context
  );

  res.status(200).json({
    success: true,
    data: { attempt, result },
    message: `Submitted. You scored ${result.score} out of ${result.totalMarks}.`,
  });
});

export const listQuizAttempts = asyncHandler(async (req: Request, res: Response) => {
  const scope = await studentWorkScopeFor(req.user!);

  const result = await AttemptService.list(
    {
      quizId: req.params.id,
      studentId: req.query.studentId as string | undefined,
      page: req.query.page !== undefined ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined,
    },
    scope
  );

  const { items, ...meta } = result;
  res.status(200).json({ success: true, data: items, meta });
});

export const getAttempt = asyncHandler(async (req: Request, res: Response) => {
  const scope = await studentWorkScopeFor(req.user!);
  res.status(200).json({ success: true, data: await AttemptService.getById(req.params.id, scope) });
});

// --- CSV question import -----------------------------------------------------

/**
 * GET /api/quizzes/questions/template
 *
 * A filled example rather than a bare header row: the two things people get
 * wrong are the header spelling and that `correctOption` is a 1-based index,
 * and both are obvious from a populated file.
 */
export const downloadQuestionTemplate = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="quiz-questions-template.csv"');
  res.status(200).send(QuestionImportService.template());
});

/**
 * POST /api/quizzes/:id/upload-csv
 *
 * The body is raw `text/csv`, parsed by a route-scoped parser — the app-wide
 * `express.json({ limit: '10kb' })` neither accepts this content type nor holds
 * a realistic file.
 *
 * Answers 200 even when rows were rejected: those that passed were imported,
 * and a 4xx would tell the client to discard a result that partly succeeded.
 * The caller reads `imported`/`failed`, not the status code.
 */
export const uploadQuestionCsv = asyncHandler(async (req: Request, res: Response) => {
  assertCanWriteCurriculum(req.user!);

  const csv = typeof req.body === 'string' ? req.body : '';
  if (!csv.trim()) {
    throw new AppError('The uploaded file is empty.', 400);
  }

  const result = await QuestionImportService.importForQuiz(req.params.id, csv);

  req.log.info('Quiz questions imported from CSV', {
    quizId: req.params.id,
    totalRows: result.totalRows,
    imported: result.imported,
    failed: result.failed,
  });

  res.status(200).json({
    success: true,
    data: result,
    message:
      result.failed === 0
        ? `Imported ${result.imported} question(s).`
        : `Imported ${result.imported} of ${result.totalRows}. ${result.failed} row(s) were rejected — see the details.`,
  });
});
