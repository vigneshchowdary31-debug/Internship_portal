import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Award, AlertTriangle, FileQuestion, Info, RefreshCw } from 'lucide-react';
import { attemptsApi } from '@/services/quizzes';

/**
 * A finished attempt's result.
 *
 * ── WHY CORRECT ANSWERS ARE NOT SHOWN ────────────────────────────────────────
 * `GET /attempts/:id` returns the attempt's own record — score, totalMarks and
 * the answers the student gave — and nothing about the QUESTIONS. There is no
 * student-reachable endpoint that returns `correctAnswer`: both
 * `QUESTION_SELECT_STUDENT` and `AttemptService.toStudentQuiz` strip it, which
 * is what stops the answer key being read out of a network tab mid-quiz.
 *
 * So a per-question right/wrong breakdown is not something the frontend can
 * assemble today. It needs a server change — and a decision, because with
 * retries still available, revealing the key hands out the answers to the next
 * attempt. See the note rendered at the foot of this page.
 */
export const QuizResultPage = () => {
  const { attemptId = '' } = useParams<{ attemptId: string }>();

  const {
    data: attempt,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => attemptsApi.get(attemptId),
    enabled: !!attemptId,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !attempt) {
    // A 404 covers both "no such attempt" and "someone else's" — the server
    // answers identically on purpose, so this message must not guess which.
    const status = (error as { response?: { status?: number } })?.response?.status;

    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <FileQuestion className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">
            {status === 403 ? 'Not available' : 'This result is not available'}
          </p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {status === 403
              ? 'You do not have access to this attempt.'
              : status === 404
                ? 'It may have been removed, or it belongs to someone else.'
                : 'Something went wrong loading this result.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {/* A network failure is worth retrying; a 403/404 never is. */}
            {status !== 403 && status !== 404 && (
              <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Try again
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/student/course">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to my course
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // An attempt still in progress has no result to show — send them back to it
  // rather than rendering a score of null.
  if (!attempt.submittedAt) {
    return <Navigate to={`/quiz/${attempt.id}`} replace />;
  }

  const { score, totalMarks, autoSubmitted, answers } = attempt;
  const percent = totalMarks ? Math.round(((score ?? 0) / totalMarks) * 100) : 0;
  const answered = answers ? Object.keys(answers).length : 0;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/student/course">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to my course
        </Link>
      </Button>

      <Card className="border-t-4 border-t-violet-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">{attempt.quiz?.title ?? 'Quiz result'}</CardTitle>
          <p className="text-sm text-gray-500">
            Submitted {new Date(attempt.submittedAt).toLocaleString()}
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-md border bg-gray-50 p-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
              <Award className="h-5 w-5 text-violet-600" />
            </span>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {score}
                <span className="text-base font-normal text-gray-500"> / {totalMarks}</span>
              </p>
              <p className="text-sm text-gray-500">{percent}%</p>
            </div>
            <div className="ml-auto text-right text-sm text-gray-500">
              <p>{answered} question(s) answered</p>
            </div>
          </div>

          {autoSubmitted && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              This attempt ran out of time and was closed automatically, so it was scored on
              whatever had been submitted by then.
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700">Your answers</p>
            {answers && answered > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {Object.entries(answers).map(([questionId, answer]) => (
                  <li key={questionId} className="rounded border bg-white px-3 py-2 text-sm text-gray-900">
                    {String(answer)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-gray-500">No answers were recorded.</p>
            )}
          </div>

          <p className="flex items-start gap-2 rounded-md border bg-gray-50 p-3 text-xs text-gray-600">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            A question-by-question breakdown is not shown. The correct answers are never sent to
            students, so that the answer key cannot be read ahead of an attempt.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
