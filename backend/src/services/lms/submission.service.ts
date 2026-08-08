import type { Prisma } from '@prisma/client';
import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { StorageService } from '../storage/storage.service';
import { assignmentVisibilityWhere, type VisibilityContext } from './visibility.service';
import { NotificationService } from './notification.service';

/**
 * Student submissions.
 *
 * THE STORAGE LAYER IS NOT REIMPLEMENTED HERE. Every file operation goes
 * through StorageService:
 *
 *   - Registering an upload is `confirmUpload()`, which stores the public_id
 *     Cloudinary RETURNED (raw assets carry the extension; the signed key does
 *     not) together with `resourceType` and `format`.
 *   - Removing a file is `deleteAsset()`, which calls the provider with that
 *     stored `resourceType` — never `auto`, which the destroy endpoint rejects —
 *     and throws unless the provider answers `"result":"ok"`.
 *
 * Nothing in this file talks to Cloudinary, computes a signature, or decides a
 * resource type. That was the whole point of the Phase 1 storage abstraction,
 * and a submission path that reached around it would have to re-learn every
 * rule above by hitting the same bugs again.
 */

export const SUBMISSION_SELECT = {
  id: true,
  assignmentId: true,
  studentId: true,
  submittedAt: true,
  isLate: true,
  attemptCount: true,
  marks: true,
  feedback: true,
  gradedAt: true,
  student: { select: { id: true, name: true, email: true, niatId: true } },
  gradedBy: { select: { id: true, name: true } },
  assignment: {
    select: { id: true, title: true, deadline: true, maxMarks: true, moduleId: true },
  },
  /**
   * The file, read through the relation. This is what lets the response carry
   * publicId / resourceType / format / fileUrl — the Phase 3 contract — while
   * the columns themselves live in exactly one table.
   */
  asset: {
    select: {
      id: true,
      providerKey: true,
      url: true,
      resourceType: true,
      format: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
};

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Response shape: the provider fields flattened to the documented names. */
export function toSubmissionResponse(row: any) {
  const { asset, ...rest } = row;
  return {
    ...rest,
    assetId: asset?.id ?? null,
    publicId: asset?.providerKey ?? null,
    resourceType: asset?.resourceType ?? null,
    format: asset?.format ?? null,
    fileUrl: asset?.url ?? null,
    originalFilename: asset?.originalFilename ?? null,
    mimeType: asset?.mimeType ?? null,
    sizeBytes: asset?.sizeBytes ?? null,
  };
}

/**
 * The mark rule, in one place.
 *
 * Extracted when bulk grading stopped calling `grade()` per item (Phase 6) so
 * the two paths could not drift into disagreeing about what a valid mark is.
 * Both call this; neither carries its own copy.
 */
export function assertMarksInRange(marks: number, maxMarks: number): void {
  if (marks < 0) {
    throw new AppError('Marks cannot be negative.', 400);
  }
  if (marks > maxMarks) {
    throw new AppError(`This assignment is out of ${maxMarks}. ${marks} is more than that.`, 400);
  }
}

export interface SubmissionFilters {
  assignmentId?: string;
  studentId?: string;
  /** `true` for late only, `false` for on-time only, undefined for both. */
  isLate?: boolean;
  /** `true` for marked only, `false` for awaiting marks. */
  graded?: boolean;
  page?: number;
  pageSize?: number;
}

export class SubmissionService {
  /**
   * Registers a student's upload as their submission.
   *
   * The client has already POSTed the file straight to Cloudinary using a
   * ticket from `/lms/uploads/sign` — bytes never pass through Node, which is
   * what keeps `express.json({ limit: '10kb' })` viable. What arrives here is
   * Cloudinary's upload RESPONSE, and it is handed to `confirmUpload()`
   * unmodified.
   *
   * Order matters and is deliberate: every guard runs BEFORE the asset is
   * registered, so a rejected submission never leaves a MediaAsset row behind
   * pointing at a file nothing will ever reference.
   */
  static async submit(input: {
    assignmentId: string;
    studentId: string;
    /** The public_id Cloudinary RETURNED. Never the key we signed. */
    providerKey: string;
    url: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    /** Cloudinary's own classification. Required — delete cannot work without it. */
    resourceType: 'image' | 'raw' | 'video';
    /** Cloudinary's normalised format. Absent for raw assets, hence optional. */
    format?: string;
    checksum?: string;
    /** The student's visibility context, so unpublished work cannot be submitted to. */
    context: VisibilityContext;
  }) {
    const assignment = await this.resolveSubmittableAssignment(
      input.assignmentId,
      input.context
    );

    const existing = await prisma.submission.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId: input.assignmentId,
          studentId: input.studentId,
        },
      },
      select: { id: true, assetId: true, attemptCount: true, marks: true },
    });

    if (existing) {
      if (!assignment.allowResubmission) {
        throw new AppError(
          'You have already submitted this assignment, and resubmissions are not allowed for it.',
          409
        );
      }
      if (existing.marks !== null) {
        // Replacing marked work would leave a mark attached to a file nobody
        // evaluated. The instructor has to clear the mark first.
        throw new AppError(
          'This submission has already been marked and can no longer be replaced.',
          409
        );
      }
    }

    // Guards passed — now register the file.
    const asset = await StorageService.confirmUpload({
      providerKey: input.providerKey,
      url: input.url,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      resourceType: input.resourceType,
      format: input.format,
      checksum: input.checksum,
      purpose: 'submission',
      uploadedById: input.studentId,
    });

    const submittedAt = new Date();
    const isLate = submittedAt.getTime() > assignment.deadline.getTime();

    const submission = await prisma.submission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId: input.assignmentId,
          studentId: input.studentId,
        },
      },
      create: {
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        assetId: asset.id,
        submittedAt,
        isLate,
      },
      update: {
        assetId: asset.id,
        submittedAt,
        isLate,
        attemptCount: { increment: 1 },
        // A replaced artifact invalidates any feedback written against the old
        // one. Nulled rather than kept so nobody reads a comment about a file
        // that is no longer there.
        marks: null,
        feedback: null,
        gradedAt: null,
        gradedById: null,
      },
      select: SUBMISSION_SELECT,
    });

    // The previous artifact is now unreferenced. Removing it is best-effort:
    // the submission is already recorded, and a Cloudinary outage must not
    // surface as a failed hand-in. A file left behind is caught by the admin
    // orphan report; a rejected submission at a deadline is not recoverable.
    if (existing?.assetId && existing.assetId !== asset.id) {
      await this.discardAsset(existing.assetId, 'superseded submission artifact');
    }

    return submission;
  }

  /**
   * The assignment a student is allowed to submit to.
   *
   * Resolved through the shared visibility clause, so a draft, an assignment in
   * a hidden module, and another batch's work are all simply "not found" — the
   * same answer, carrying no information about which of the three it was.
   */
  private static async resolveSubmittableAssignment(
    assignmentId: string,
    context: VisibilityContext
  ) {
    const assignment = await prisma.assignment.findFirst({
      where: { AND: [{ id: assignmentId }, assignmentVisibilityWhere(context)] },
      select: {
        id: true,
        title: true,
        deadline: true,
        maxMarks: true,
        allowResubmission: true,
        isPublished: true,
      },
    });

    if (!assignment) throw new AppError('Assignment not found', 404);
    return assignment;
  }

  /**
   * Removes an artifact from storage, swallowing failure.
   *
   * Used on the paths where the database state is already correct and the file
   * is merely surplus. Throwing here would report a failure for an operation
   * that succeeded, and invite a retry that cannot help.
   */
  private static async discardAsset(assetId: string, reason: string) {
    try {
      await StorageService.deleteAsset(assetId);
    } catch (error: any) {
      console.error(
        `[lms] Failed to remove ${reason} (asset ${assetId}):`,
        error?.message || error
      );
    }
  }

  // --- Reads ---------------------------------------------------------------

  /**
   * Paginated list within the viewer's scope.
   *
   * `scope` comes from the policy layer as a `where` fragment and is applied in
   * SQL, not after the fact: filtering a fetched page in memory would leave the
   * total counting work the viewer is not allowed to see.
   */
  static async list(
    filters: SubmissionFilters,
    scope: Prisma.SubmissionWhereInput
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const conditions: Prisma.SubmissionWhereInput[] = [scope];

    if (filters.assignmentId) conditions.push({ assignmentId: filters.assignmentId });
    if (filters.studentId) conditions.push({ studentId: filters.studentId });
    if (filters.isLate !== undefined) conditions.push({ isLate: filters.isLate });
    if (filters.graded !== undefined) {
      conditions.push(filters.graded ? { marks: { not: null } } : { marks: null });
    }

    const where: Prisma.SubmissionWhereInput = { AND: conditions };

    const [items, total] = await prisma.$transaction([
      prisma.submission.findMany({
        where,
        select: SUBMISSION_SELECT,
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      items: items.map(toSubmissionResponse),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
    };
  }

  /** One submission, resolved inside the viewer's scope rather than checked after. */
  static async getById(id: string, scope: Prisma.SubmissionWhereInput) {
    const submission = await prisma.submission.findFirst({
      where: { AND: [{ id }, scope] },
      select: SUBMISSION_SELECT,
    });
    if (!submission) throw new AppError('Submission not found', 404);
    return toSubmissionResponse(submission);
  }

  // --- Evaluation ----------------------------------------------------------

  /**
   * Records a mark and feedback, then tells the student.
   *
   * The mark is bounded by the assignment's own `maxMarks` — awarding 120 out
   * of 100 is the kind of typo that quietly corrupts every average Module 4
   * computes, and it is cheap to refuse here.
   */
  static async grade(
    id: string,
    data: { marks: number; feedback?: string | null },
    graderId: string,
    scope: Prisma.SubmissionWhereInput
  ) {
    const submission = await prisma.submission.findFirst({
      where: { AND: [{ id }, scope] },
      select: { id: true, assignment: { select: { maxMarks: true } } },
    });
    if (!submission) throw new AppError('Submission not found', 404);

    assertMarksInRange(data.marks, submission.assignment.maxMarks);

    const updated = await prisma.submission.update({
      where: { id },
      data: {
        marks: data.marks,
        feedback: data.feedback?.trim() || null,
        gradedAt: new Date(),
        gradedById: graderId,
      },
      select: SUBMISSION_SELECT,
    });

    // Same isolation as publishing: the mark is recorded, so a mail outage must
    // not surface as a failed grade and invite a retry that double-notifies.
    try {
      await NotificationService.announceSubmissionEvaluated(id, graderId);
    } catch (error: any) {
      console.error(
        `[lms] Submission ${id} marked, but notifying the student failed:`,
        error?.message || error
      );
    }

    return toSubmissionResponse(updated);
  }

  /**
   * Marks many submissions in one request.
   *
   * ── THE SHAPE, AND WHY (Phase 6 rewrite) ─────────────────────────────────
   * Three phases, in this order:
   *
   *   1. RESOLVE  — one `findMany` fetches every requested submission inside
   *                 the viewer's scope, with its assignment's maxMarks.
   *   2. VALIDATE — per item, in memory. Anything not found, out of scope or
   *                 out of range is set aside as a failure here.
   *   3. WRITE    — the survivors go in ONE transaction of `update` calls.
   *
   * The previous version looped over `grade()`, costing 2 queries and one
   * blocking SMTP conversation per item: forty papers was eighty round trips
   * and forty emails, inside the request. This is 1 read + 1 transaction, and
   * the mail is queued afterwards.
   *
   * ── PARTIAL SUCCESS SURVIVES THE TRANSACTION ─────────────────────────────
   * A transaction is all-or-nothing, which sounds like the opposite of partial
   * success — the reconciliation is that everything that CAN fail per item has
   * already failed in phase 2, before the transaction opens. What remains is a
   * set of validated updates, and those fail only together (a connection drop),
   * where rolling back is the right answer anyway. An instructor still never
   * loses twenty-nine good marks to one bad row.
   *
   * ── VALIDATION IS NOT DUPLICATED ─────────────────────────────────────────
   * The mark bounds come from `assertMarksInRange`, the same function `grade()`
   * calls. The viewer scope comes from the same `where` fragment. Only the
   * ORCHESTRATION differs; the rules have one home each.
   */
  static async bulkGrade(
    items: { submissionId: string; marks: number; feedback?: string | null }[],
    graderId: string,
    scope: Prisma.SubmissionWhereInput
  ) {
    const results: {
      submissionId: string;
      status: 'graded' | 'failed';
      marks?: number;
      reason?: string;
    }[] = [];

    if (items.length === 0) {
      return { requested: 0, graded: 0, failed: 0, results };
    }

    // --- 1. Resolve: one query for the whole batch, inside the viewer's scope.
    const found = await prisma.submission.findMany({
      where: { AND: [{ id: { in: items.map((i) => i.submissionId) } }, scope] },
      select: { id: true, assignment: { select: { maxMarks: true } } },
    });
    const byId = new Map(found.map((s) => [s.id, s]));

    // --- 2. Validate in memory. Everything that can fail per item fails here.
    const gradedAt = new Date();
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const accepted: { submissionId: string; marks: number }[] = [];

    for (const item of items) {
      const submission = byId.get(item.submissionId);

      // A scope miss and a genuine 404 are the SAME answer, deliberately: an
      // instructor must not learn that a submission exists in a batch they do
      // not teach.
      if (!submission) {
        results.push({
          submissionId: item.submissionId,
          status: 'failed',
          reason: 'Submission not found',
        });
        continue;
      }

      try {
        assertMarksInRange(item.marks, submission.assignment.maxMarks);
      } catch (error: any) {
        results.push({
          submissionId: item.submissionId,
          status: 'failed',
          reason: error?.message ?? 'Could not be marked.',
        });
        continue;
      }

      writes.push(
        prisma.submission.update({
          where: { id: item.submissionId },
          data: {
            marks: item.marks,
            feedback: item.feedback?.trim() || null,
            gradedAt,
            gradedById: graderId,
          },
        })
      );
      accepted.push({ submissionId: item.submissionId, marks: item.marks });
    }

    // --- 3. Write the survivors together.
    if (writes.length > 0) {
      await prisma.$transaction(writes);
      for (const row of accepted) {
        results.push({ submissionId: row.submissionId, status: 'graded', marks: row.marks });
      }
    }

    // --- Notify: in-app rows per submission, ONE digest email per student.
    // After the commit and outside it, so a mail problem can neither roll back
    // a mark nor delay the response. Same isolation as the single-grade path.
    if (accepted.length > 0) {
      try {
        await NotificationService.announceSubmissionsEvaluated(
          accepted.map((a) => a.submissionId),
          graderId
        );
      } catch (error: any) {
        console.error(
          '[lms] Marks saved, but notifying students failed:',
          error?.message || error
        );
      }
    }

    // Restored to request order: the results array is read alongside the rows
    // the instructor typed, and phase 2 emits failures before successes.
    const order = new Map(items.map((item, index) => [item.submissionId, index]));
    results.sort((a, b) => (order.get(a.submissionId) ?? 0) - (order.get(b.submissionId) ?? 0));

    return {
      requested: items.length,
      graded: accepted.length,
      failed: results.length - accepted.length,
      results,
    };
  }

  // --- Delete --------------------------------------------------------------

  /**
   * Withdraws a submission and removes its file.
   *
   * The row goes first, then the artifact. That order is forced by the Restrict
   * foreign key — `deleteAsset` refuses while a submission still points at the
   * file — and it is the safe direction anyway: a file that outlives its row is
   * surplus storage the orphan report will surface, whereas a row that outlives
   * its file is a submission whose evidence has vanished.
   *
   * `deleteAsset` performs the provider call with the stored `resourceType`,
   * which is the only reason a `raw` .zip and an `image` .pdf both actually
   * delete rather than returning a successful-looking `"not found"`.
   */
  static async remove(id: string, scope: Prisma.SubmissionWhereInput) {
    const submission = await prisma.submission.findFirst({
      where: { AND: [{ id }, scope] },
      select: { id: true, assetId: true, marks: true },
    });
    if (!submission) throw new AppError('Submission not found', 404);

    if (submission.marks !== null) {
      throw new AppError(
        'This submission has already been marked and cannot be withdrawn.',
        409
      );
    }

    await prisma.submission.delete({ where: { id } });
    await this.discardAsset(submission.assetId, 'withdrawn submission artifact');

    return true;
  }
}
