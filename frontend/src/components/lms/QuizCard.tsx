import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Timer, ListChecks, Repeat, Loader2, Play, RotateCw, Eye } from 'lucide-react';
import type { Quiz, Attempt } from '@/services/quizzes';
import { cn } from '@/lib/utils';

/**
 * A quiz as a student sees it.
 *
 * Purely presentational: it renders what it is given and reports clicks. The
 * status arrives as a prop rather than being derived here, so the derivation is
 * a pure function that can be tested against every attempt shape without
 * rendering anything.
 */

export type QuizStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'COMPLETED_FINAL';

/**
 * Works out where a student stands with one quiz.
 *
 * ── ON `maxAttempts === null` ───────────────────────────────────────────────
 * Null means UNLIMITED, and the naive `maxAttempts - attemptsUsed` yields NaN
 * for it — which renders as "NaN attempts left" and compares falsely in every
 * direction. Unlimited can therefore never reach COMPLETED_FINAL, which is the
 * correct meaning and not a special case bolted on.
 *
 * Only CLOSED attempts count as used, matching the server: an attempt still
 * open is the one in progress, not one spent.
 */
export function deriveQuizStatus(
  attempts: Attempt[],
  maxAttempts: number | null
): { status: QuizStatus; attemptsUsed: number; attemptsLeft: number | null; openAttempt: Attempt | null } {
  const openAttempt = attempts.find((a) => a.submittedAt === null) ?? null;
  const completed = attempts.filter((a) => a.submittedAt !== null);
  const attemptsUsed = completed.length;
  const attemptsLeft = maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed);

  let status: QuizStatus;
  if (openAttempt) status = 'IN_PROGRESS';
  else if (attemptsUsed === 0) status = 'NOT_STARTED';
  else if (attemptsLeft === null || attemptsLeft > 0) status = 'COMPLETED';
  else status = 'COMPLETED_FINAL';

  return { status, attemptsUsed, attemptsLeft, openAttempt };
}

/** The most recently finished attempt — what "View result" should open. */
export function latestCompletedAttempt(attempts: Attempt[]): Attempt | null {
  const completed = attempts
    .filter((a) => a.submittedAt !== null)
    .sort((a, b) => new Date(b.submittedAt!).getTime() - new Date(a.submittedAt!).getTime());
  return completed[0] ?? null;
}

export function QuizCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-white p-3">
      <Skeleton className="h-9 w-9 rounded-md" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

export function QuizCard({
  quiz,
  status,
  attemptsUsed,
  attemptsLeft,
  bestPercent,
  isStarting = false,
  onStart,
  onResume,
  onViewResult,
}: {
  quiz: Quiz;
  status: QuizStatus;
  attemptsUsed: number;
  /** Null means unlimited. */
  attemptsLeft: number | null;
  bestPercent?: number | null;
  isStarting?: boolean;
  onStart: () => void;
  onResume: () => void;
  onViewResult: () => void;
}) {
  const totalMarks = quiz._count.questions;

  return (
    <div className="flex items-start gap-3 rounded-md border bg-white p-3">
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-violet-50">
        <ListChecks className="h-4 w-4 text-violet-600" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900">{quiz.title}</span>

          {status === 'IN_PROGRESS' && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
              In progress
            </Badge>
          )}
          {status === 'COMPLETED' && (
            <Badge variant="outline" className="border-green-200 bg-green-50 text-[10px] text-green-700">
              Completed
            </Badge>
          )}
          {status === 'COMPLETED_FINAL' && (
            <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[10px] text-gray-600">
              No attempts left
            </Badge>
          )}
        </div>

        {quiz.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{quiz.description}</p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Timer className="h-3 w-3" />
            {quiz.timeLimit} min
          </span>
          <span className="flex items-center gap-1">
            <ListChecks className="h-3 w-3" />
            {totalMarks} question{totalMarks === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1">
            <Repeat className="h-3 w-3" />
            {attemptsLeft === null
              ? `${attemptsUsed} used · unlimited`
              : `${attemptsLeft} of ${quiz.maxAttempts} attempt${quiz.maxAttempts === 1 ? '' : 's'} left`}
          </span>
          {bestPercent !== null && bestPercent !== undefined && (
            <span className="font-medium text-green-700">Best {bestPercent}%</span>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {/* A finished attempt is always reachable, even while more are allowed —
            a student checking last time's score should not have to start a new
            attempt to see it. */}
        {attemptsUsed > 0 && status !== 'COMPLETED_FINAL' && (
          <Button size="sm" variant="ghost" onClick={onViewResult}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Result
          </Button>
        )}

        {status === 'IN_PROGRESS' ? (
          <Button size="sm" onClick={onResume} className={cn('bg-amber-600 hover:bg-amber-700')}>
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            Resume Quiz
          </Button>
        ) : status === 'COMPLETED_FINAL' ? (
          <Button size="sm" variant="outline" onClick={onViewResult}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            View Result
          </Button>
        ) : (
          <Button size="sm" disabled={isStarting} onClick={onStart}>
            {isStarting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            {status === 'COMPLETED' ? 'Retry Quiz' : 'Start Quiz'}
          </Button>
        )}
      </div>
    </div>
  );
}
