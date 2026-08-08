import { Router, text } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as quizzes from '../controllers/quiz.controller';
import {
  createQuizSchema,
  updateQuizSchema,
  listQuizzesSchema,
  quizIdSchema,
  createQuestionSchema,
  updateQuestionSchema,
  questionIdSchema,
  startAttemptSchema,
  submitAttemptSchema,
  listAttemptsSchema,
  attemptIdSchema,
} from '../validators/quiz.validator';

/**
 * Quiz routes — Phase 3, M3. Mounted at /api/quizzes.
 *
 * Authorization is NOT expressed with `restrictTo()`, matching the rest of the
 * LMS: the rules are relational ("batches I am assigned to"), which a role gate
 * cannot express, so each handler consults the policy layer.
 */
export const quizRouter = Router();

quizRouter.use(authenticate);

/**
 * CSV body parser, scoped to the import route.
 *
 * The app-wide `express.json({ limit: '10kb' })` neither accepts text/csv nor
 * holds a realistic file. 2 MB comfortably covers the 200-row cap the service
 * enforces, and matches what the user-import route already uses.
 */
const csvBody = text({ type: 'text/csv', limit: '2mb' });

/**
 * An import is a bulk write behind a file upload — cheap to repeat by accident
 * (a double-click on the file picker) and expensive to serve. The global
 * limiter would let one client spend its whole budget here.
 */
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: { message: 'Too many import requests. Please wait a moment.', code: 'RATE_LIMITED' },
    message: 'Too many import requests. Please wait a moment.',
  },
});

// Declared before '/:id' so "questions" is never captured as a quiz id.
quizRouter.get('/questions/template', quizzes.downloadQuestionTemplate);
quizRouter.post(
  '/:id/upload-csv',
  importLimiter,
  csvBody,
  validate(quizIdSchema),
  quizzes.uploadQuestionCsv
);

// Attempt routes are declared before /:id so `start` and `submit` are never
// shadowed by the generic quiz lookup.
quizRouter.post('/:id/start', validate(startAttemptSchema), quizzes.startAttempt);
quizRouter.post('/:id/submit', validate(submitAttemptSchema), quizzes.submitAttempt);
quizRouter.get('/:id/attempts', validate(listAttemptsSchema), quizzes.listQuizAttempts);

// Questions
quizRouter.post('/:id/questions', validate(createQuestionSchema), quizzes.addQuestion);
quizRouter.patch('/:id/questions/:questionId', validate(updateQuestionSchema), quizzes.updateQuestion);
quizRouter.delete('/:id/questions/:questionId', validate(questionIdSchema), quizzes.deleteQuestion);

// Quizzes
quizRouter.get('/', validate(listQuizzesSchema), quizzes.listQuizzes);
quizRouter.post('/', validate(createQuizSchema), quizzes.createQuiz);
quizRouter.get('/:id', validate(quizIdSchema), quizzes.getQuiz);
quizRouter.patch('/:id', validate(updateQuizSchema), quizzes.updateQuiz);
quizRouter.delete('/:id', validate(quizIdSchema), quizzes.deleteQuiz);

/**
 * Mounted separately at /api/attempts, per the Phase 3 M3 contract — an attempt
 * is addressable on its own, without knowing which quiz it belongs to.
 */
export const attemptRouter = Router();

attemptRouter.use(authenticate);
attemptRouter.get('/:id', validate(attemptIdSchema), quizzes.getAttempt);

export default quizRouter;
