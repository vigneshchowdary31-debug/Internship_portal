import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Plus,
  Loader2,
  Timer,
  ListChecks,
  Users,
  Search,
  Pencil,
  Trash2,
  Send,
  Undo2,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react';
import { QuizFormDialog } from '@/components/lms/QuizFormDialog';
import { quizzesApi, type Quiz, type QuizPayload } from '@/services/quizzes';
import { cn } from '@/lib/utils';

/**
 * Admin quiz management.
 *
 * Three server rules drive most of the affordances here, and the UI states each
 * one BEFORE the click rather than surfacing it as an error afterwards:
 *
 *   - A quiz with no questions cannot be published.
 *   - Once anyone has attempted it, its questions freeze.
 *   - A quiz with attempts cannot be deleted at all.
 */

type StatusFilter = 'all' | 'draft' | 'published';

export const QuizzesManagement = () => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Quiz | null>(null);
  const [toDelete, setToDelete] = useState<Quiz | null>(null);

  const {
    data: quizzes = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['quizzes'],
    queryFn: () => quizzesApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['quizzes'] });

  const create = useMutation({
    mutationFn: ({ moduleId, ...body }: QuizPayload & { moduleId: string }) =>
      quizzesApi.create(moduleId, body),
    onSuccess: () => {
      invalidate();
      setIsFormOpen(false);
      toast.success('Quiz created', 'Add questions, then publish it.');
    },
    onError: (err) => toast.error('Could not create quiz', errorMessage(err)),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: QuizPayload & { id: string }) => quizzesApi.update(id, body),
    onSuccess: () => {
      invalidate();
      setIsFormOpen(false);
      setEditing(null);
      toast.success('Quiz updated');
    },
    onError: (err) => toast.error('Could not save changes', errorMessage(err)),
  });

  const setPublished = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => quizzesApi.setPublished(id, next),
    onSuccess: (_data, { next }) => {
      invalidate();
      toast.success(
        next ? 'Published' : 'Withdrawn',
        next ? 'Students on this curriculum have been notified.' : 'Students can no longer see it.'
      );
    },
    onError: (err) => toast.error('Could not change status', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => quizzesApi.remove(id),
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      toast.success('Quiz deleted');
    },
    onError: (err) => {
      setToDelete(null);
      toast.error('Could not delete', errorMessage(err));
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quizzes.filter((quiz) => {
      if (status === 'draft' && quiz.isPublished) return false;
      if (status === 'published' && !quiz.isPublished) return false;
      if (term) {
        const haystack = `${quiz.title} ${quiz.module?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [quizzes, search, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quizzes</h1>
          <p className="text-sm text-gray-500">
            Timed, auto-marked assessments attached to a curriculum module.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setIsFormOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Quiz
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or module"
            className="pl-8"
            aria-label="Search quizzes"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Drafts</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading quizzes…
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center py-14 text-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-300" />
            <p className="font-medium text-gray-700">Could not load quizzes</p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : quizzes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <ClipboardList className="mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-700">No quizzes yet</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Create the first one. It saves as a draft, so nothing reaches students until you
              have added questions and published it.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setEditing(null);
                setIsFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Quiz
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">
              No quizzes match these filters.{' '}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                }}
              >
                Clear filters
              </button>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quiz</TableHead>
                <TableHead>Module</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="w-64 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((quiz) => {
                const empty = quiz._count.questions === 0;
                const sat = quiz._count.attempts > 0;

                return (
                  <TableRow key={quiz.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-gray-900">{quiz.title}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            quiz.isPublished
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : 'border-gray-200 bg-gray-50 text-gray-600'
                          )}
                        >
                          {quiz.isPublished ? 'Published' : 'Draft'}
                        </Badge>
                      </div>
                      {empty && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          No questions — cannot be published yet
                        </p>
                      )}
                    </TableCell>

                    <TableCell className="text-sm text-gray-600">
                      {quiz.module?.name ?? '—'}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-right text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <Timer className="h-3 w-3 text-gray-400" />
                        {quiz.timeLimit} min
                      </span>
                    </TableCell>

                    <TableCell className="text-right text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <ListChecks className="h-3 w-3 text-gray-400" />
                        {quiz._count.questions}
                      </span>
                    </TableCell>

                    <TableCell className="text-right text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3 text-gray-400" />
                        {quiz._count.attempts}
                      </span>
                      <span className="ml-1 text-xs text-gray-400">
                        / {quiz.maxAttempts === null ? '∞' : quiz.maxAttempts}
                      </span>
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/admin/quizzes/${quiz.id}/questions`}>
                            <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                            Questions
                          </Link>
                        </Button>

                        {quiz.isPublished ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setPublished.isPending}
                            onClick={() => setPublished.mutate({ id: quiz.id, next: false })}
                          >
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                            Withdraw
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            // Stated before the click: the server refuses this.
                            disabled={empty || setPublished.isPending}
                            title={empty ? 'Add at least one question first' : undefined}
                            onClick={() => setPublished.mutate({ id: quiz.id, next: true })}
                          >
                            <Send className="mr-1.5 h-3.5 w-3.5 text-green-600" />
                            Publish
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label={`Edit ${quiz.title}`}
                          onClick={() => {
                            setEditing(quiz);
                            setIsFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-600"
                          aria-label={`Delete ${quiz.title}`}
                          disabled={sat}
                          title={sat ? 'Students have sat this quiz — it cannot be deleted' : undefined}
                          onClick={() => setToDelete(quiz)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <QuizFormDialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditing(null);
        }}
        initialData={editing}
        isLoading={create.isPending || update.isPending}
        onSubmit={(values) => {
          if (editing) {
            const { moduleId: _ignored, ...body } = values;
            update.mutate({ id: editing.id, ...body });
          } else {
            create.mutate(values);
          }
        }}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This quiz has no student attempts, so nothing is lost. Its questions are deleted
              with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={remove.isPending}
              onClick={() => toDelete && remove.mutate(toDelete.id)}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
