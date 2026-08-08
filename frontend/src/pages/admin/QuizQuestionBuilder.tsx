import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  ArrowLeft,
  Plus,
  Loader2,
  Timer,
  ListChecks,
  Pencil,
  Trash2,
  CheckCircle2,
  Lock,
  FileQuestion,
  Send,
  Upload,
} from 'lucide-react';
import { QuestionFormDialog } from '@/components/lms/QuestionFormDialog';
import { QuestionCsvDialog } from '@/components/lms/QuestionCsvDialog';
import { quizzesApi, type QuizQuestion, type QuestionPayload } from '@/services/quizzes';
import { cn } from '@/lib/utils';

/**
 * Question builder for one quiz.
 *
 * ── THE FREEZE RULE, SHOWN NOT DISCOVERED ────────────────────────────────────
 * The server refuses to add, edit or delete a question once anyone has
 * attempted the quiz: `Attempt.score` and `totalMarks` are recorded against the
 * questions as they stood, and changing a correct answer afterwards leaves
 * stored marks that no longer follow from the paper.
 *
 * That rule is surfaced up front — a banner and disabled controls — rather than
 * left to a 409 after someone has typed out a question. The error handling is
 * still there for the race where a student starts mid-edit.
 */
export const QuizQuestionBuilder = () => {
  const { id = '' } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuizQuestion | null>(null);
  const [toDelete, setToDelete] = useState<QuizQuestion | null>(null);
  const [isCsvOpen, setIsCsvOpen] = useState(false);

  const {
    data: quiz,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['quiz', id],
    queryFn: () => quizzesApi.get(id),
    enabled: !!id,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['quiz', id] });
    // The list shows a question count, which just changed.
    queryClient.invalidateQueries({ queryKey: ['quizzes'] });
  };

  const add = useMutation({
    mutationFn: (body: QuestionPayload) => quizzesApi.addQuestion(id, body),
    onSuccess: () => {
      invalidate();
      setIsFormOpen(false);
      toast.success('Question added');
    },
    onError: (err) => toast.error('Could not add question', errorMessage(err)),
  });

  const update = useMutation({
    mutationFn: ({ questionId, body }: { questionId: string; body: QuestionPayload }) =>
      quizzesApi.updateQuestion(id, questionId, body),
    onSuccess: () => {
      invalidate();
      setIsFormOpen(false);
      setEditing(null);
      toast.success('Question updated');
    },
    onError: (err) => toast.error('Could not save changes', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (questionId: string) => quizzesApi.removeQuestion(id, questionId),
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      toast.success('Question removed');
    },
    onError: (err) => {
      setToDelete(null);
      toast.error('Could not remove question', errorMessage(err));
    },
  });

  const publish = useMutation({
    mutationFn: () => quizzesApi.setPublished(id, true),
    onSuccess: () => {
      invalidate();
      toast.success('Published', 'Students on this curriculum have been notified.');
    },
    onError: (err) => toast.error('Could not publish', errorMessage(err)),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading quiz…
      </div>
    );
  }

  if (isError || !quiz) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <FileQuestion className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">This quiz is not available</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            It may have been deleted, or it is not part of a curriculum you can manage.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/admin/quizzes">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to quizzes
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const questions = quiz.questions ?? [];
  const frozen = quiz._count.attempts > 0;
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/admin/quizzes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to quizzes
          </Link>
        </Button>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{quiz.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              {quiz.module?.name && <span>{quiz.module.name}</span>}
              <Badge variant="outline" className="gap-1">
                <Timer className="h-3 w-3" />
                {quiz.timeLimit} min
              </Badge>
              <Badge variant="outline" className="gap-1">
                <ListChecks className="h-3 w-3" />
                {questions.length} question{questions.length === 1 ? '' : 's'} · {totalMarks} marks
              </Badge>
              <Badge
                variant="outline"
                className={
                  quiz.isPublished
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600'
                }
              >
                {quiz.isPublished ? 'Published' : 'Draft'}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!quiz.isPublished && questions.length > 0 && (
              <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
                {publish.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Publish
              </Button>
            )}
            <Button
              variant="outline"
              disabled={frozen}
              title={frozen ? 'Students have already attempted this quiz' : undefined}
              onClick={() => setIsCsvOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload CSV
            </Button>
            <Button
              variant={quiz.isPublished ? 'default' : 'outline'}
              disabled={frozen}
              title={frozen ? 'Students have already attempted this quiz' : undefined}
              onClick={() => {
                setEditing(null);
                setIsFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Question
            </Button>
          </div>
        </div>
      </div>

      {frozen && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3">
          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">
              Questions are locked — {quiz._count.attempts} student attempt
              {quiz._count.attempts === 1 ? ' has' : 's have'} been recorded.
            </p>
            <p className="mt-0.5 text-amber-800">
              Each attempt's score was calculated against these exact questions. Changing them now
              would leave marks that no longer follow from the paper. To change the questions,
              create a new quiz.
            </p>
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <ListChecks className="mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-700">No questions yet</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              A quiz cannot be published until it has at least one question — a student would
              open an empty paper and score 0 out of 0.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                disabled={frozen}
                onClick={() => {
                  setEditing(null);
                  setIsFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add the first question
              </Button>
              <Button variant="outline" disabled={frozen} onClick={() => setIsCsvOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Upload CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {questions.map((question, index) => (
            <div key={question.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{question.question}</p>

                  <ul className="mt-2 space-y-1">
                    {question.options.map((option) => {
                      const isCorrect = option === question.correctAnswer;
                      return (
                        <li
                          key={option}
                          className={cn(
                            'flex items-center gap-2 rounded px-2 py-1 text-sm',
                            isCorrect ? 'bg-green-50 font-medium text-green-800' : 'text-gray-600'
                          )}
                        >
                          {isCorrect ? (
                            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-green-600" />
                          ) : (
                            <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-gray-300" />
                          )}
                          {option}
                        </li>
                      );
                    })}
                  </ul>

                  <p className="mt-2 text-xs text-gray-400">
                    {question.marks} mark{question.marks === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={frozen}
                    aria-label={`Edit question ${index + 1}`}
                    onClick={() => {
                      setEditing(question);
                      setIsFormOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-600"
                    disabled={frozen}
                    aria-label={`Remove question ${index + 1}`}
                    onClick={() => setToDelete(question)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <QuestionFormDialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditing(null);
        }}
        initialData={editing}
        isLoading={add.isPending || update.isPending}
        onSubmit={(values) => {
          if (editing) update.mutate({ questionId: editing.id, body: values });
          else add.mutate(values);
        }}
      />

      <QuestionCsvDialog
        quizId={id}
        open={isCsvOpen}
        onOpenChange={setIsCsvOpen}
        onImported={invalidate}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this question?</AlertDialogTitle>
            <AlertDialogDescription>
              “{toDelete?.question}” will be deleted. Nobody has attempted this quiz, so no marks
              are affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={remove.isPending}
              onClick={() => toDelete && remove.mutate(toDelete.id)}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
