import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  QuizCard,
  QuizCardSkeleton,
  deriveQuizStatus,
  latestCompletedAttempt,
} from './QuizCard';
import { attemptsApi, type Quiz } from '@/services/quizzes';

/**
 * Container for one quiz card: fetches this student's attempts, derives the
 * status, and hands both to the presentational `QuizCard`.
 *
 * ── WHY IT FETCHES ITS OWN ATTEMPTS ─────────────────────────────────────────
 * The quiz list carries `_count.attempts`, but that counts EVERY student's
 * attempts. Using it for "attempts used" would show a cohort total and let one
 * student infer how many classmates had sat the quiz.
 * `GET /quizzes/:id/attempts` is scoped by the server to the caller's own rows.
 *
 * One request per card, only once the module is expanded. Fine for the handful
 * a module carries; if one ever holds dozens, the fix is a student-facing
 * attempts list filtered by quiz, not a wider count on the quiz.
 */
export function StudentQuizRow({ quiz }: { quiz: Quiz }) {
  const navigate = useNavigate();
  const toast = useToast();

  const { data: attempts = [], isLoading } = useQuery({
    queryKey: ['attempts', quiz.id],
    queryFn: () => attemptsApi.listForQuiz(quiz.id),
  });

  const { status, attemptsUsed, attemptsLeft, openAttempt } = deriveQuizStatus(
    attempts,
    quiz.maxAttempts
  );

  /** Best mark so far, as a percentage — how a student reads "how did I do". */
  const bestPercent = attempts.reduce<number | null>((best, attempt) => {
    if (attempt.score === null || !attempt.totalMarks) return best;
    const percent = Math.round((attempt.score / attempt.totalMarks) * 100);
    return best === null || percent > best ? percent : best;
  }, null);

  const start = useMutation({
    mutationFn: () => attemptsApi.start(quiz.id),
    onSuccess: (started) => navigate(`/quiz/${started.attempt.id}`),
    // Covers what the UI cannot pre-empt: the cap reached in another tab, or
    // the quiz withdrawn between page load and click.
    onError: (err) => toast.error('Could not start the quiz', errorMessage(err)),
  });

  const openResult = () => {
    const latest = latestCompletedAttempt(attempts);
    if (latest) navigate(`/quiz/result/${latest.id}`);
  };

  if (isLoading) return <QuizCardSkeleton />;

  return (
    <QuizCard
      quiz={quiz}
      status={status}
      attemptsUsed={attemptsUsed}
      attemptsLeft={attemptsLeft}
      bestPercent={bestPercent}
      isStarting={start.isPending}
      onStart={() => start.mutate()}
      onResume={() => openAttempt && navigate(`/quiz/${openAttempt.id}`)}
      onViewResult={openResult}
    />
  );
}
