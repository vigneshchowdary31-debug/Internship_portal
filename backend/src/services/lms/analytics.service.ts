import type { Prisma } from '@prisma/client';
import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import {
  assignmentVisibilityWhere,
  isPublishableVisible,
  type VisibilityContext,
} from './visibility.service';

/**
 * Analytics — every number computed at read time, none of them stored.
 *
 * ── WHY NOTHING IS CACHED ────────────────────────────────────────────────────
 * A stored `progressPercentage` would need invalidating whenever an assignment
 * is published, withdrawn, made batch-specific, moved into a hidden module,
 * deleted, re-marked, or when a student changes batch. That is seven writers
 * for one number, and the first missed invalidation shows a student a figure
 * they cannot refresh away. Derived is not a performance compromise here; it is
 * the only version that cannot be wrong.
 *
 * ── HOW THE VISIBILITY RULE STAYS SINGLE-SOURCE ──────────────────────────────
 * The tempting implementation is one big `$queryRaw` with the scope rules
 * hand-written into SQL. That would be a second copy of the resolver, in a
 * language where nobody would notice it drifting. Instead every method here
 * follows the same two-step shape:
 *
 *   1. Resolve the VISIBLE ASSIGNMENT SET through the shared resolver — either
 *      `assignmentVisibilityWhere` (SQL) or `isPublishableVisible` (in-memory).
 *      This set is small: assignments per curriculum number in the tens.
 *   2. Aggregate the LARGE table (Submission) with Prisma's groupBy/aggregate,
 *      restricted to that id set.
 *
 * So the heavy work is real aggregation in the database, the rule lives in one
 * file, and neither step needs the other to be re-implemented.
 */

/** A student is at risk below this much assignment completion. */
export const AT_RISK_PROGRESS_PERCENT = 30;
/** …or above this share of their submissions arriving late. */
export const AT_RISK_LATE_RATIO = 0.5;

export interface StudentAnalytics {
  totalAssignments: number;
  completedAssignments: number;
  pendingAssignments: number;
  lateSubmissions: number;
  /**
   * Mean of (marks ÷ that assignment's maxMarks) × 100, over MARKED work only.
   *
   * A percentage rather than a raw mark average: a 10-mark exercise and a
   * 100-mark project are not comparable totals, and averaging them raw weights
   * the project ten times heavier by accident. 0 when nothing is marked yet.
   */
  averageScore: number;
  progressPercentage: number;
}

export interface CourseAnalytics {
  totalStudents: number;
  totalAssignments: number;
  assignmentCompletionRate: number;
  averageScore: number;
  lateSubmissionRate: number;
  submissionsPerAssignment: { assignmentId: string; title: string; submissionCount: number }[];
}

export interface AssignmentAnalytics {
  totalSubmissions: number;
  gradedSubmissions: number;
  averageMarks: number;
  highestMarks: number;
  lowestMarks: number;
  lateCount: number;
}

export interface AtRiskStudent {
  studentId: string;
  name: string;
  email: string;
  niatId: string | null;
  batch: { id: string; name: string } | null;
  totalAssignments: number;
  submitted: number;
  lateSubmissions: number;
  progressPercentage: number;
  reasons: ('NO_SUBMISSIONS' | 'LOW_PROGRESS' | 'MOSTLY_LATE')[];
}

/** Percentages are whole numbers, and 0/0 is 0 rather than NaN. */
function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Mean score as a percentage, computed from GROUPED aggregates — no rows read.
 *
 * The identity that makes this exact: for each assignment, the sum of its marks
 * is `avg × count`. So
 *
 *   mean(markᵢ / maxᵢ) = Σₐ (avgₐ × countₐ ÷ maxₐ) ÷ Σₐ countₐ
 *
 * which needs only one `groupBy` row per assignment, however many thousands of
 * submissions sit underneath. Fetching every submission to divide in JavaScript
 * gives the same answer and does not scale past one cohort.
 */
function averagePercentFromGroups(
  groups: { assignmentId: string; _avg: { marks: number | null }; _count: { marks: number } }[],
  maxMarksById: Map<string, number>
): number {
  let weightedSum = 0;
  let graded = 0;

  for (const group of groups) {
    const max = maxMarksById.get(group.assignmentId);
    const count = group._count.marks;
    // `_avg.marks` is null when no row in the group has a mark; a maxMarks of 0
    // cannot occur (the validator floors it at 1) but is guarded anyway,
    // because a division by zero here would poison the whole average.
    if (!max || !count || group._avg.marks === null) continue;
    weightedSum += (group._avg.marks * count) / max;
    graded += count;
  }

  return graded === 0 ? 0 : Math.round((weightedSum / graded) * 100);
}

export class AnalyticsService {
  /**
   * Resolves the assignments a given context can see, with the two fields the
   * aggregations need. Small by nature — tens of rows per curriculum.
   */
  private static async visibleAssignments(
    learningPathIds: string[],
    context: VisibilityContext
  ): Promise<{ id: string; title: string; maxMarks: number }[]> {
    if (learningPathIds.length === 0) return [];
    return prisma.assignment.findMany({
      where: {
        AND: [{ learningPathId: { in: learningPathIds } }, assignmentVisibilityWhere(context)],
      },
      select: { id: true, title: true, maxMarks: true },
      orderBy: { deadline: 'asc' },
    });
  }

  // --- 1. Student ----------------------------------------------------------

  /**
   * One student's own standing.
   *
   * The denominator is what THIS student can see, resolved against their own
   * batch — not every assignment on the curriculum. Counting a batch-scoped
   * assignment set for another cohort would put 100% permanently out of reach.
   */
  static async forStudent(
    studentId: string,
    learningPathIds: string[],
    context: VisibilityContext
  ): Promise<StudentAnalytics> {
    const assignments = await this.visibleAssignments(learningPathIds, context);

    const totalAssignments = assignments.length;
    if (totalAssignments === 0) {
      return {
        totalAssignments: 0,
        completedAssignments: 0,
        pendingAssignments: 0,
        lateSubmissions: 0,
        averageScore: 0,
        progressPercentage: 0,
      };
    }

    const assignmentIds = assignments.map((a) => a.id);
    const maxMarksById = new Map(assignments.map((a) => [a.id, a.maxMarks]));
    const scope = { studentId, assignmentId: { in: assignmentIds } };

    // Promise.all rather than $transaction, for the reason SearchService.facets
    // already documents: these are independent read-only aggregates that never
    // need to agree with each other to the row, and $transaction erases
    // groupBy's narrow return type.
    const [completedAssignments, lateSubmissions, scoreGroups] = await Promise.all([
      prisma.submission.count({ where: scope }),
      prisma.submission.count({ where: { ...scope, isLate: true } }),
      prisma.submission.groupBy({
        by: ['assignmentId'],
        where: { ...scope, marks: { not: null } },
        _avg: { marks: true },
        _count: { marks: true },
        orderBy: { assignmentId: 'asc' },
      }),
    ]);

    return {
      totalAssignments,
      completedAssignments,
      pendingAssignments: Math.max(0, totalAssignments - completedAssignments),
      lateSubmissions,
      averageScore: averagePercentFromGroups(scoreGroups, maxMarksById),
      progressPercentage: percent(completedAssignments, totalAssignments),
    };
  }

  // --- 2. Course -----------------------------------------------------------

  /**
   * Cohort-level insight for one curriculum.
   *
   * `batchIds` narrows to an instructor's own batches; an admin passes them all.
   *
   * The completion denominator is NOT `students × assignments`. A batch-scoped
   * assignment is only expected of that batch, so counting it against every
   * student on the path makes a cohort look permanently behind. Expected work
   * is summed per assignment against the students actually eligible for it.
   */
  static async forCourse(
    learningPathId: string,
    batchIds: string[],
    context: VisibilityContext
  ): Promise<CourseAnalytics> {
    const [assignments, batchSizes] = await Promise.all([
      prisma.assignment.findMany({
        where: { AND: [{ learningPathId }, assignmentVisibilityWhere(context)] },
        select: { id: true, title: true, maxMarks: true, scope: true, batchId: true },
        orderBy: { deadline: 'asc' },
      }),
      prisma.studentBatch.groupBy({
        by: ['batchId'],
        where: { batchId: { in: batchIds } },
        _count: { _all: true },
        orderBy: { batchId: 'asc' },
      }),
    ]);

    const sizeByBatch = new Map(batchSizes.map((b) => [b.batchId, b._count._all]));
    const totalStudents = batchSizes.reduce((sum, b) => sum + b._count._all, 0);

    if (assignments.length === 0 || totalStudents === 0) {
      return {
        totalStudents,
        totalAssignments: assignments.length,
        assignmentCompletionRate: 0,
        averageScore: 0,
        lateSubmissionRate: 0,
        submissionsPerAssignment: assignments.map((a) => ({
          assignmentId: a.id,
          title: a.title,
          submissionCount: 0,
        })),
      };
    }

    const assignmentIds = assignments.map((a) => a.id);
    const maxMarksById = new Map(assignments.map((a) => [a.id, a.maxMarks]));

    // Submissions are restricted to students in scope as well as assignments in
    // scope: an instructor's completion rate must not be moved by a cohort they
    // do not teach.
    const scope = {
      assignmentId: { in: assignmentIds },
      student: { studentBatches: { some: { batchId: { in: batchIds } } } },
    };

    const [totalSubmissions, lateSubmissions, perAssignment, scoreGroups] =
      await Promise.all([
        prisma.submission.count({ where: scope }),
        prisma.submission.count({ where: { ...scope, isLate: true } }),
        prisma.submission.groupBy({
          by: ['assignmentId'],
          where: scope,
          _count: { _all: true },
          orderBy: { assignmentId: 'asc' },
        }),
        prisma.submission.groupBy({
          by: ['assignmentId'],
          where: { ...scope, marks: { not: null } },
          _avg: { marks: true },
          _count: { marks: true },
          orderBy: { assignmentId: 'asc' },
        }),
      ]);

    // Expected work: each assignment counts only against its eligible students.
    const expectedSubmissions = assignments.reduce((sum, a) => {
      if (a.scope === 'BATCH') return sum + (a.batchId ? (sizeByBatch.get(a.batchId) ?? 0) : 0);
      return sum + totalStudents;
    }, 0);

    const countById = new Map(perAssignment.map((r) => [r.assignmentId, r._count._all]));

    return {
      totalStudents,
      totalAssignments: assignments.length,
      assignmentCompletionRate: percent(totalSubmissions, expectedSubmissions),
      averageScore: averagePercentFromGroups(scoreGroups, maxMarksById),
      lateSubmissionRate: percent(lateSubmissions, totalSubmissions),
      submissionsPerAssignment: assignments.map((a) => ({
        assignmentId: a.id,
        title: a.title,
        submissionCount: countById.get(a.id) ?? 0,
      })),
    };
  }

  // --- 3. Assignment -------------------------------------------------------

  /**
   * One assignment's spread.
   *
   * Raw marks here, not percentages: within a single assignment every
   * submission shares one `maxMarks`, so the numbers are directly comparable
   * and an instructor wants to read them in the units they marked in.
   *
   * `_avg`/`_max`/`_min` skip nulls, so ungraded work does not drag the average
   * to zero — but it is still counted in `totalSubmissions`, which is why
   * `gradedSubmissions` is reported alongside. "Average 78 out of 3 submissions"
   * reads very differently once you know only one has been marked.
   */
  static async forAssignment(
    assignmentId: string,
    /**
     * Optional viewer scope from the policy layer (Phase 5).
     *
     * Omitted, this reports the whole cohort — the admin view. An instructor
     * passes `studentWorkScopeFor(user)` so their grading progress reflects the
     * batches they actually teach: "9 of 12 marked" must not count a parallel
     * cohort's submissions they cannot open, let alone mark.
     */
    scope: Prisma.SubmissionWhereInput = {}
  ): Promise<AssignmentAnalytics> {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true },
    });
    if (!assignment) throw new AppError('Assignment not found', 404);

    const where = { AND: [{ assignmentId }, scope] };

    const [totals, lateCount] = await Promise.all([
      prisma.submission.aggregate({
        where,
        _count: { _all: true, marks: true },
        _avg: { marks: true },
        _max: { marks: true },
        _min: { marks: true },
      }),
      prisma.submission.count({ where: { AND: [{ assignmentId, isLate: true }, scope] } }),
    ]);

    return {
      totalSubmissions: totals._count._all,
      gradedSubmissions: totals._count.marks,
      // Null whenever nothing is marked — reported as 0, never as null, so a
      // client never has to branch on the empty case to render a number.
      averageMarks: totals._avg.marks === null ? 0 : Math.round(totals._avg.marks * 10) / 10,
      highestMarks: totals._max.marks ?? 0,
      lowestMarks: totals._min.marks ?? 0,
      lateCount,
    };
  }

  // --- 4. At-risk ----------------------------------------------------------

  /**
   * Students who need attention, across the batches in scope.
   *
   * Deliberately NOT one query per student. The shape is:
   *
   *   1 query for the batches, 1 for their students, 1 for every assignment on
   *   the involved paths, then 2 grouped aggregates over Submission.
   *
   * Five queries regardless of cohort size. Per-batch denominators are resolved
   * in memory with `isPublishableVisible` — the resolver's own pure predicate,
   * the same rule the SQL builder implements — so batch-scoped assignments
   * count only against the batch they belong to, without a query per batch.
   */
  static async atRisk(batchIds: string[]): Promise<AtRiskStudent[]> {
    if (batchIds.length === 0) return [];

    const batches = await prisma.batch.findMany({
      where: { id: { in: batchIds }, learningPathId: { not: null } },
      select: { id: true, name: true, learningPathId: true },
    });
    if (batches.length === 0) return [];

    const learningPathIds = [...new Set(batches.map((b) => b.learningPathId!))];

    const [students, allAssignments] = await Promise.all([
      prisma.user.findMany({
        where: {
          role: 'STUDENT',
          status: true,
          studentBatches: { some: { batchId: { in: batchIds } } },
        },
        select: {
          id: true,
          name: true,
          email: true,
          niatId: true,
          studentBatches: { select: { batchId: true } },
        },
      }),
      // Every assignment on the involved paths, unfiltered by batch — the
      // per-batch cut happens below with the shared predicate.
      prisma.assignment.findMany({
        where: { learningPathId: { in: learningPathIds } },
        select: {
          id: true,
          learningPathId: true,
          isPublished: true,
          scope: true,
          batchId: true,
          module: { select: { isVisible: true } },
        },
      }),
    ]);

    if (students.length === 0) return [];

    // Denominator per batch, using the resolver's pure predicate rather than a
    // second copy of the rule written for this screen.
    const assignmentCountByBatch = new Map<string, number>();
    for (const batch of batches) {
      const visible = allAssignments.filter(
        (a) =>
          a.learningPathId === batch.learningPathId &&
          isPublishableVisible(a, { batchId: batch.id, includeUnpublished: false })
      );
      assignmentCountByBatch.set(batch.id, visible.length);
    }

    const batchById = new Map(batches.map((b) => [b.id, b]));
    const studentIds = students.map((s) => s.id);

    const [submitted, late] = await Promise.all([
      prisma.submission.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds } },
        _count: { _all: true },
        orderBy: { studentId: 'asc' },
      }),
      prisma.submission.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, isLate: true },
        _count: { _all: true },
        orderBy: { studentId: 'asc' },
      }),
    ]);

    const submittedByStudent = new Map(submitted.map((r) => [r.studentId, r._count._all]));
    const lateByStudent = new Map(late.map((r) => [r.studentId, r._count._all]));

    const atRisk: AtRiskStudent[] = [];

    for (const student of students) {
      const batchId = student.studentBatches.find((sb) => batchById.has(sb.batchId))?.batchId;
      const batch = batchId ? batchById.get(batchId) : undefined;
      const totalAssignments = batchId ? (assignmentCountByBatch.get(batchId) ?? 0) : 0;

      const submittedCount = submittedByStudent.get(student.id) ?? 0;
      const lateCount = lateByStudent.get(student.id) ?? 0;
      const progressPercentage = percent(submittedCount, totalAssignments);

      const reasons: AtRiskStudent['reasons'] = [];

      // A cohort with nothing set yet is not "at risk" — it has not started.
      // Without this guard every student flags on day one at 0/0, and a signal
      // that fires for everyone is one nobody reads.
      if (totalAssignments > 0) {
        if (submittedCount === 0) reasons.push('NO_SUBMISSIONS');
        else if (progressPercentage < AT_RISK_PROGRESS_PERCENT) reasons.push('LOW_PROGRESS');

        if (submittedCount > 0 && lateCount / submittedCount > AT_RISK_LATE_RATIO) {
          reasons.push('MOSTLY_LATE');
        }
      }

      if (reasons.length === 0) continue;

      atRisk.push({
        studentId: student.id,
        name: student.name,
        email: student.email,
        niatId: student.niatId,
        batch: batch ? { id: batch.id, name: batch.name } : null,
        totalAssignments,
        submitted: submittedCount,
        lateSubmissions: lateCount,
        progressPercentage,
        reasons,
      });
    }

    // Worst first — the list is a work queue, not a report.
    return atRisk.sort((a, b) => a.progressPercentage - b.progressPercentage);
  }
}
