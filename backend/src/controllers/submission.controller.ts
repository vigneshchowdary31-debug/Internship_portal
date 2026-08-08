import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { SubmissionService } from '../services/lms/submission.service';
import { AnalyticsService } from '../services/lms/analytics.service';
import {
  assertCanEvaluate,
  assertCanSubmit,
  buildVisibilityContext,
  submissionScopeFor,
} from '../policies/lms.policy';

/**
 * Submissions (Phase 3, M2).
 *
 * Read authorization is a `where` fragment from `submissionScopeFor`, applied
 * in SQL by the service. Deliberately not a per-row check after fetching: that
 * shape hides rows but still counts them, so a student would learn how many
 * classmates had handed in.
 */

export const createSubmission = asyncHandler(async (req: Request, res: Response) => {
  assertCanSubmit(req.user!);

  // A student's context, so an unpublished assignment, one in a hidden module,
  // and another batch's work are all equally "not found".
  const context = await buildVisibilityContext(req.user!);

  const submission = await SubmissionService.submit({
    assignmentId: req.body.assignmentId,
    studentId: req.user!.id,
    providerKey: req.body.providerKey,
    url: req.body.url,
    originalFilename: req.body.originalFilename,
    mimeType: req.body.mimeType,
    sizeBytes: req.body.sizeBytes,
    resourceType: req.body.resourceType,
    format: req.body.format,
    checksum: req.body.checksum,
    context,
  });

  res.status(201).json({
    success: true,
    data: submission,
    message: submission.isLate
      ? 'Submitted after the deadline. Your work has been recorded and flagged as late.'
      : 'Submitted. Your work has been recorded.',
  });
});

export const listSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const scope = await submissionScopeFor(req.user!);

  const result = await SubmissionService.list(
    {
      assignmentId: req.query.assignmentId as string | undefined,
      studentId: req.query.studentId as string | undefined,
      isLate: req.query.isLate !== undefined ? req.query.isLate === 'true' : undefined,
      graded: req.query.graded !== undefined ? req.query.graded === 'true' : undefined,
      page: req.query.page !== undefined ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined,
    },
    scope
  );

  const { items, ...meta } = result;
  res.status(200).json({ success: true, data: items, meta });
});

export const getSubmission = asyncHandler(async (req: Request, res: Response) => {
  const scope = await submissionScopeFor(req.user!);
  res
    .status(200)
    .json({ success: true, data: await SubmissionService.getById(req.params.id, scope) });
});

export const gradeSubmission = asyncHandler(async (req: Request, res: Response) => {
  assertCanEvaluate(req.user!);
  const scope = await submissionScopeFor(req.user!);

  const submission = await SubmissionService.grade(
    req.params.id,
    { marks: req.body.marks, feedback: req.body.feedback },
    req.user!.id,
    scope
  );

  // A mark is a decision about a person's work; who changed it and when is
  // worth having outside the database, where `gradedAt` records only the most
  // recent one and a re-grade overwrites the previous value entirely.
  req.log.info('Submission graded', {
    submissionId: submission.id,
    assignmentId: submission.assignmentId,
    marks: submission.marks,
    isRegrade: submission.attemptCount > 1 || submission.gradedAt !== null,
  });

  res.status(200).json({
    success: true,
    data: submission,
    message: 'Marked. The student has been notified.',
  });
});

/**
 * PATCH /api/submissions/bulk-grade
 *
 * Answers 200 even when some items failed, with a per-item breakdown — a
 * partial success is exactly what happened, and a 4xx would tell the client to
 * discard marks that were in fact recorded. 207 would be more precise but is
 * not something the existing error envelope or any current caller understands.
 */
export const bulkGradeSubmissions = asyncHandler(async (req: Request, res: Response) => {
  assertCanEvaluate(req.user!);
  const scope = await submissionScopeFor(req.user!);

  const started = Date.now();
  const outcome = await SubmissionService.bulkGrade(req.body, req.user!.id, scope);

  // The bulk summary: one line an operator can search for when an instructor
  // reports "some of my marks didn't save". Failure reasons are included
  // because the per-item detail is what makes that answerable — the response
  // went to the browser and is gone.
  req.log.info('Bulk grading completed', {
    requested: outcome.requested,
    graded: outcome.graded,
    failed: outcome.failed,
    durationMs: Date.now() - started,
    ...(outcome.failed > 0
      ? {
          failures: outcome.results
            .filter((r) => r.status === 'failed')
            .map((r) => ({ submissionId: r.submissionId, reason: r.reason })),
        }
      : {}),
  });

  res.status(200).json({
    success: true,
    data: outcome,
    message:
      outcome.failed === 0
        ? `Marked ${outcome.graded} submission(s). Students have been notified.`
        : `Marked ${outcome.graded} of ${outcome.requested}. ${outcome.failed} could not be marked — see results.`,
  });
});

/**
 * GET /api/instructor/assignment/:id/progress
 *
 * Reuses AnalyticsService.forAssignment rather than counting again here. The
 * numbers an instructor sees on the grading screen and the numbers on the
 * analytics screen are then the same numbers, because they are one query.
 */
export const gradingProgress = asyncHandler(async (req: Request, res: Response) => {
  assertCanEvaluate(req.user!);
  const scope = await submissionScopeFor(req.user!);

  const stats = await AnalyticsService.forAssignment(req.params.id, scope);

  res.status(200).json({
    success: true,
    data: {
      totalSubmissions: stats.totalSubmissions,
      gradedCount: stats.gradedSubmissions,
      pendingCount: stats.totalSubmissions - stats.gradedSubmissions,
      lateCount: stats.lateCount,
    },
  });
});

/**
 * Withdraws a submission and deletes its file.
 *
 * Instructors are excluded on purpose: their role is to evaluate work, and the
 * ability to delete a student's evidence is a different power from the ability
 * to mark it. Students withdraw their own unmarked work; admins can remove
 * anything.
 */
export const deleteSubmission = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.role === 'INSTRUCTOR') {
    throw new AppError(
      'Instructors cannot delete student submissions. Mark the work, or ask an administrator to remove it.',
      403
    );
  }

  const scope = await submissionScopeFor(user);
  await SubmissionService.remove(req.params.id, scope);

  res.status(200).json({ success: true, message: 'Submission withdrawn and its file deleted.' });
});
