import type { Prisma } from '@prisma/client';
import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { assertBatchOnPath } from './batch-scope';
import { assignmentVisibilityWhere, type VisibilityContext } from './visibility.service';
import { NotificationService } from './notification.service';

/**
 * Assignments — graded work attached to a module.
 *
 * Every read goes through `assignmentVisibilityWhere`. Nothing in this file
 * decides for itself whether a student may see a row; it supplies the caller's
 * filters (module, due date, search term) and AND-s them with the shared rule.
 * A filter that forgets the visibility clause returns another batch's work and
 * still passes every test that only checks the filter, which is exactly the bug
 * the single-resolver design exists to make impossible.
 */

export const ASSIGNMENT_SELECT = {
  id: true,
  moduleId: true,
  learningPathId: true,
  title: true,
  description: true,
  maxMarks: true,
  deadline: true,
  isPublished: true,
  publishedAt: true,
  scope: true,
  batchId: true,
  allowResubmission: true,
  createdAt: true,
  updatedAt: true,
  module: { select: { id: true, name: true, isVisible: true } },
  batch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export interface AssignmentFilters {
  moduleId?: string;
  learningPathId?: string;
  /**
   * Restricts to a set of paths — how the controller expresses "everything this
   * caller can reach" for an instructor who teaches more than one curriculum.
   * An empty array means nothing is reachable and is honoured as such, rather
   * than being treated as "no filter".
   */
  learningPathIds?: string[];
  batchId?: string;
  /** Free text over title and description. */
  q?: string;
  /**
   * `published` / `draft` narrow the set; `all` is the default. Drafts are
   * unreachable for a student regardless of what they ask for — the visibility
   * clause has already removed them before this filter is applied.
   */
  status?: 'draft' | 'published' | 'all';
  dueBefore?: Date;
  dueAfter?: Date;
  sort?: 'deadline' | '-deadline' | 'createdAt' | '-createdAt';
  page?: number;
  pageSize?: number;
}

export class AssignmentService {
  // --- Reads ---------------------------------------------------------------

  /**
   * Paginated list within the caller's visibility.
   *
   * Ordered by deadline ascending by default: the question a student opens this
   * screen to answer is "what is due next", and `createdAt` answers a different
   * one.
   */
  static async list(filters: AssignmentFilters, context: VisibilityContext) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const conditions: Prisma.AssignmentWhereInput[] = [assignmentVisibilityWhere(context)];

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

    if (filters.dueBefore) conditions.push({ deadline: { lte: filters.dueBefore } });
    if (filters.dueAfter) conditions.push({ deadline: { gte: filters.dueAfter } });

    const where: Prisma.AssignmentWhereInput = { AND: conditions };

    const [items, total] = await prisma.$transaction([
      prisma.assignment.findMany({
        where,
        select: ASSIGNMENT_SELECT,
        orderBy: orderByFor(filters.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.assignment.count({ where }),
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
   * Single assignment, resolved through the same visibility clause as the list.
   *
   * Fetching by id and then checking is the classic hole: it makes the 404/403
   * distinction leak the existence of a draft. Here an invisible row simply is
   * not found.
   */
  static async getById(id: string, context: VisibilityContext) {
    const assignment = await prisma.assignment.findFirst({
      where: { AND: [{ id }, assignmentVisibilityWhere(context)] },
      select: ASSIGNMENT_SELECT,
    });
    if (!assignment) throw new AppError('Assignment not found', 404);
    return assignment;
  }

  /** Unfiltered read for the write paths, which have already been authorized. */
  private static async requireById(id: string) {
    const assignment = await prisma.assignment.findUnique({ where: { id } });
    if (!assignment) throw new AppError('Assignment not found', 404);
    return assignment;
  }

  /**
   * The authoring view of one assignment: no visibility filter, because the
   * caller has already passed `assertCanWriteCurriculum`. Deliberately named
   * apart from `getById` so a read path cannot reach for it by autocomplete.
   */
  static async getByIdForWrite(id: string) {
    await this.requireById(id);
    return prisma.assignment.findUniqueOrThrow({ where: { id }, select: ASSIGNMENT_SELECT });
  }

  // --- Writes --------------------------------------------------------------

  static async create(data: {
    moduleId: string;
    title: string;
    description: string;
    maxMarks: number;
    deadline: Date;
    scope?: 'LEARNING_PATH' | 'BATCH';
    batchId?: string | null;
    allowResubmission?: boolean;
    /**
     * Publishing at creation time is allowed, and notifies immediately. An
     * author who wants to review before students see it simply omits this.
     */
    isPublished?: boolean;
    createdById: string;
  }) {
    const module = await prisma.module.findUnique({
      where: { id: data.moduleId },
      select: { id: true, learningPathId: true },
    });
    if (!module) throw new AppError('Module not found', 404);

    assertFutureDeadline(data.deadline);

    const scope = data.scope ?? 'LEARNING_PATH';
    if (scope === 'BATCH') {
      if (!data.batchId) throw new AppError('A batch is required for batch-scoped work.', 400);
      await assertBatchOnPath(data.batchId, module.learningPathId);
    }

    const created = await prisma.assignment.create({
      data: {
        moduleId: data.moduleId,
        learningPathId: module.learningPathId,
        title: data.title.trim(),
        description: data.description.trim(),
        maxMarks: data.maxMarks,
        deadline: data.deadline,
        scope,
        batchId: scope === 'BATCH' ? data.batchId : null,
        ...(data.allowResubmission !== undefined
          ? { allowResubmission: data.allowResubmission }
          : {}),
        createdById: data.createdById,
      },
      select: ASSIGNMENT_SELECT,
    });

    if (data.isPublished) {
      return this.setPublished(created.id, true, data.createdById);
    }
    return created;
  }

  /**
   * Field edits only. Publication is a separate transition (`setPublished`)
   * because it has a side effect — a fan-out to every student — that must not
   * be reachable by accident from a title correction.
   */
  static async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      maxMarks?: number;
      deadline?: Date;
      allowResubmission?: boolean;
    }
  ) {
    const existing = await this.requireById(id);

    if (data.deadline !== undefined) assertFutureDeadline(data.deadline);

    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() } : {}),
        ...(data.maxMarks !== undefined ? { maxMarks: data.maxMarks } : {}),
        ...(data.deadline !== undefined ? { deadline: data.deadline } : {}),
        ...(data.allowResubmission !== undefined
          ? { allowResubmission: data.allowResubmission }
          : {}),
      },
      select: ASSIGNMENT_SELECT,
    });

    if (data.deadline !== undefined && data.deadline.getTime() !== existing.deadline.getTime()) {
      await this.recomputeLateness(id, data.deadline);
    }

    return updated;
  }

  /**
   * Re-derives `Submission.isLate` for every submission against a new deadline.
   *
   * `isLate` is stored (Phase 3 M2 requires the column) but must never disagree
   * with the deadline it came from. Extending a deadline is the case that
   * matters: students who handed in during the extension were flagged late at
   * write time and would stay late forever, which is a mark of shame the
   * extension was explicitly granted to remove.
   *
   * Two updateMany calls in one transaction rather than a read-modify-write per
   * row — the whole cohort is rewritten in two statements, and the pair either
   * both land or neither does.
   */
  private static async recomputeLateness(assignmentId: string, deadline: Date) {
    await prisma.$transaction([
      prisma.submission.updateMany({
        where: { assignmentId, submittedAt: { lte: deadline } },
        data: { isLate: false },
      }),
      prisma.submission.updateMany({
        where: { assignmentId, submittedAt: { gt: deadline } },
        data: { isLate: true },
      }),
    ]);
  }

  /**
   * Publishes or withdraws an assignment.
   *
   * The notification fires only on a real false -> true transition, mirroring
   * ContentService.setStatus. Re-publishing an already-published assignment
   * must not re-alert the cohort: students who receive the same "new
   * assignment" mail twice learn to ignore the channel entirely.
   *
   * Publishing work whose deadline has already passed is refused. It is always
   * a mistake — the student's first sight of the assignment would be as
   * something they had already failed to submit — and it is the one deadline
   * error that cannot be corrected after the fact.
   *
   * Announcement failure never fails the publish: the assignment IS live at
   * that point, and reporting an error invites a retry that double-notifies.
   */
  static async setPublished(id: string, isPublished: boolean, actorId: string | null = null) {
    const existing = await this.requireById(id);

    if (isPublished && !existing.isPublished) {
      assertFutureDeadline(
        existing.deadline,
        'This assignment is past its deadline. Set a future deadline before publishing it.'
      );
    }

    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        isPublished,
        // Stamped once, on the first publish. Withdrawing and re-publishing
        // keeps the original date so "when was this set" stays truthful.
        ...(isPublished && !existing.publishedAt ? { publishedAt: new Date() } : {}),
      },
      select: ASSIGNMENT_SELECT,
    });

    if (isPublished && !existing.isPublished) {
      try {
        await NotificationService.announceAssignmentPublished(id, actorId);
      } catch (error: any) {
        console.error(
          `[lms] Assignment ${id} published, but notifying students failed:`,
          error?.message || error
        );
      }
    }

    return updated;
  }

  /**
   * Deletes an assignment — but never one students have handed work in for.
   *
   * `Submission.assignmentId` is `onDelete: Cascade`, so without this check a
   * single delete destroys every student's submission, their marks and their
   * feedback. The damage does not stop at the database either: each submission
   * holds a MediaAsset, and cascading the rows away leaves those files in
   * Cloudinary with nothing referencing them — invisible even to the admin
   * orphan report, which only lists assets that have a MediaAsset row.
   *
   * The check is here rather than left to the foreign key because the FK
   * CASCADES; there is no database error to catch. This is the only thing
   * standing between one click and unrecoverable student work.
   *
   * 409 rather than 400: the request is well-formed, and it is the current
   * state of the resource — submissions exist — that makes it impossible.
   */
  static async remove(id: string) {
    const assignment = await this.requireById(id);

    const submissions = await prisma.submission.count({ where: { assignmentId: id } });

    if (submissions > 0) {
      throw new AppError(
        `Cannot delete "${assignment.title}": ${submissions} student submission(s) exist. ` +
          `Withdraw it instead — that hides it from students while keeping their work, marks and feedback intact.`,
        409
      );
    }

    await prisma.assignment.delete({ where: { id } });
    return true;
  }
}

/**
 * A deadline in the past is rejected on every write path, not just creation.
 *
 * Editing one onto a live assignment is the same mistake as setting one, and
 * catching it only at create leaves the more damaging version — a deadline
 * quietly moved backwards under students who are mid-submission — unguarded.
 */
function assertFutureDeadline(deadline: Date, message?: string): void {
  if (!(deadline instanceof Date) || Number.isNaN(deadline.getTime())) {
    throw new AppError('The deadline is not a valid date.', 400);
  }
  if (deadline.getTime() <= Date.now()) {
    throw new AppError(message ?? 'The deadline must be in the future.', 400);
  }
}

/** Sort key → Prisma ordering. `id` breaks ties so pages never overlap. */
function orderByFor(sort: AssignmentFilters['sort']): Prisma.AssignmentOrderByWithRelationInput[] {
  switch (sort) {
    case '-deadline':
      return [{ deadline: 'desc' }, { id: 'asc' }];
    case 'createdAt':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case '-createdAt':
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    default:
      // "What is due next" — the question this screen is opened to answer.
      return [{ deadline: 'asc' }, { id: 'asc' }];
  }
}
