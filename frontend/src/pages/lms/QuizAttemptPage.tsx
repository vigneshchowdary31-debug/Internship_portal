import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  ArrowLeft,
  Loader2,
  Timer,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  Send,
} from 'lucide-react';
import { attemptsApi, type StudentQuestion } from '@/services/quizzes';
import { cn } from '@/lib/utils';

/**
 * A student sitting one quiz — and, once submitted, their result.
 *
 * ── WHY THIS RE-CALLS `start` ────────────────────────────────────────────────
 * `GET /attempts/:id` returns the attempt but NOT the questions, and there is no
 * separate student questions endpoint (deliberately: the only path that hands
 * out a paper is the one that starts the clock). `POST /quizzes/:id/start`
 * RESUMES an open attempt rather than creating another, returning the questions
 * and the true remaining seconds — so calling it on mount rehydrates a reload
 * without burning an attempt or granting more time.
 *
 * ── THE CLOCK IS THE SERVER'S ────────────────────────────────────────────────
 * The countdown below is a display of `secondsRemaining`, which the server
 * computed from the `expiresAt` it pinned at start. Nothing here decides when
 * time is up: the auto-submit at zero is a courtesy so an unattended tab still
 * files an answer sheet, and the server independently rejects anything arriving
 * past its own deadline plus a 30-second grace.
 */

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const QuizAttemptPage = () => {
  const { attemptId = '' } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** Guards against the timer and a click both firing a submit. */
  const submitted = useRef(false);

  // 1. What attempt is this, and is it already finished?
  const attempt = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => attemptsApi.get(attemptId),
    enabled: !!attemptId,
    retry: false,
  });

  const quizId = attempt.data?.quizId;
  const isFinished = !!attempt.data?.submittedAt;

  // 2. Only for an OPEN attempt: resume it to get the paper and the clock.
  const session = useQuery({
    queryKey: ['attempt-session', attemptId],
    queryFn: () => attemptsApi.start(quizId!),
    enabled: !!quizId && attempt.isSuccess && !isFinished,
    retry: false,
    // The paper does not change mid-attempt, and refetching would reset the
    // clock display to a server value the countdown has already moved past.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const questions: StudentQuestion[] = useMemo(
    () => session.data?.quiz.questions ?? [],
    [session.data]
  );

  const submit = useMutation({
    mutationFn: (payload: Record<string, string>) => attemptsApi.submit(quizId!, payload),
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ['attempt', attemptId] });
      queryClient.invalidateQueries({ queryKey: ['attempts', quizId] });
      queryClient.invalidateQueries({ queryKey: ['lms', 'my-curriculum'] });
      toast.success('Submitted', `You scored ${result.score} out of ${result.totalMarks}.`);
      navigate(`/quiz/result/${attemptId}`, { replace: true });
    },
    onError: (err) => {
      // Re-arm so a network blip does not leave the student unable to retry.
      submitted.current = false;
      toast.error('Could not submit', errorMessage(err));
    },
  });

  const doSubmit = useCallback(
    (reason: 'manual' | 'timeout') => {
      if (submitted.current || !quizId) return;
      submitted.current = true;
      if (reason === 'timeout') {
        toast.error('Time is up', 'Your answers were submitted automatically.');
      }
      submit.mutate(answers);
    },
    [answers, quizId, submit, toast]
  );

  // Seed the countdown from the server's own figure, once.
  useEffect(() => {
    if (session.data && secondsLeft === null) setSecondsLeft(session.data.secondsRemaining);
  }, [session.data, secondsLeft]);

  // Tick. Cleared on unmount so a submitted attempt cannot fire a second one.
  useEffect(() => {
    if (secondsLeft === null || isFinished) return;
    if (secondsLeft <= 0) {
      doSubmit('timeout');
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, isFinished, doSubmit]);

  // --- Loading / not found ---------------------------------------------------

  if (attempt.isLoading || (!isFinished && session.isLoading && !session.isError)) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading quiz…
      </div>
    );
  }

  if (attempt.isError || !attempt.data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <FileQuestion className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">This attempt is not available</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            It may belong to someone else, or the quiz has been withdrawn.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/student/course">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to my course
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }


  // --- Already submitted ----------------------------------------------------

  // The result has its own route so it can be linked to and revisited. Landing
  // here on a finished attempt — a bookmark, a back button, or the redirect
  // after submitting — sends the student there rather than rendering a second
  // copy of the result view.
  if (isFinished) {
    return <Navigate to={`/quiz/result/${attemptId}`} replace />;
  }

  // --- Sitting the quiz ------------------------------------------------------

  if (session.isError || !session.data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-amber-300" />
          <p className="font-medium text-gray-700">Could not open this quiz</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {session.error ? errorMessage(session.error) : 'Please try again.'}
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/student/course">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to my course
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const answered = Object.keys(answers).length;
  const running = secondsLeft ?? session.data.secondsRemaining;
  const urgent = running <= 60;

  return (
    <div className="space-y-5">
      {/* Sticky so the clock is never scrolled off a long paper. */}
      <div className="sticky top-0 z-10 -mx-4 border-b bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-gray-900">{session.data.quiz.title}</h1>
            <p className="text-xs text-gray-500">
              {answered} of {questions.length} answered
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-sm font-semibold tabular-nums',
                urgent ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 text-gray-700'
              )}
              role="timer"
              aria-live={urgent ? 'assertive' : 'off'}
            >
              <Timer className="h-4 w-4" />
              {formatClock(running)}
            </span>

            <Button onClick={() => doSubmit('manual')} disabled={submit.isPending}>
              {submit.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Submit
            </Button>
          </div>
        </div>
      </div>

      {session.data.resumed && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          You picked this attempt back up — the clock kept running while you were away.
        </p>
      )}

      <div className="space-y-3">
        {questions.map((question, index) => (
          <Card key={question.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium text-gray-900">{question.question}</p>
                    <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                      {question.marks} mark{question.marks === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  <div className="mt-2.5 space-y-1.5">
                    {question.options.map((option) => {
                      const selected = answers[question.id] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setAnswers((current) => ({ ...current, [question.id]: option }))
                          }
                          disabled={submit.isPending}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                            selected
                              ? 'border-violet-400 bg-violet-50 font-medium text-violet-900'
                              : 'bg-white hover:border-gray-300 hover:bg-gray-50'
                          )}
                          aria-pressed={selected}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border',
                              selected ? 'border-violet-500 bg-violet-500' : 'border-gray-300'
                            )}
                          >
                            {selected && <CheckCircle2 className="h-3 w-3 text-white" />}
                          </span>
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-gray-50 p-4">
        <p className="flex items-center gap-1.5 text-sm text-gray-600">
          <ListChecks className="h-4 w-4 text-gray-400" />
          {answered === questions.length
            ? 'All questions answered.'
            : `${questions.length - answered} question(s) still unanswered — they will be marked wrong.`}
        </p>
        <Button onClick={() => doSubmit('manual')} disabled={submit.isPending}>
          {submit.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Submit quiz
        </Button>
      </div>
    </div>
  );
};
