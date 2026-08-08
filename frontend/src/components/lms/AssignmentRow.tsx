import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  ClipboardList,
  MoreHorizontal,
  Pencil,
  Trash2,
  Send,
  Undo2,
  CalendarClock,
  AlertTriangle,
  Layers,
  ClipboardCheck,
} from 'lucide-react';
import { assignmentsApi, type Assignment } from '@/services/assignments';
import { cn } from '@/lib/utils';

/**
 * One assignment in the admin curriculum view.
 *
 * Shows the facts that decide whether a student can act on it: whether it is
 * published, when it is due, and whether that moment has passed. An overdue
 * DRAFT is called out because the server refuses to publish one — the deadline
 * has to move first, and knowing that before clicking Publish saves a
 * confusing error.
 */
export function AssignmentRow({
  assignment,
  canEdit,
  onEdit,
  onChanged,
}: {
  assignment: Assignment;
  canEdit: boolean;
  onEdit: (assignment: Assignment) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const setPublished = useMutation({
    mutationFn: (next: boolean) => assignmentsApi.setPublished(assignment.id, next),
    onSuccess: (_d, next) => {
      onChanged();
      toast.success(
        next ? 'Published' : 'Withdrawn',
        next ? 'Students on this curriculum have been notified.' : 'Students can no longer see it.'
      );
    },
    onError: (err) => toast.error('Could not change status', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => assignmentsApi.remove(assignment.id),
    onSuccess: () => {
      setConfirmingDelete(false);
      onChanged();
      toast.success('Assignment deleted');
    },
    onError: (err) => {
      setConfirmingDelete(false);
      toast.error('Could not delete', errorMessage(err));
    },
  });

  const due = new Date(assignment.deadline);
  const overdue = due.getTime() < Date.now();

  return (
    <>
      <div className="flex items-start gap-3 rounded-md border bg-white p-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-amber-50">
          <ClipboardList className="h-4 w-4 text-amber-600" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-gray-900">{assignment.title}</span>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px]',
                assignment.isPublished
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
              )}
            >
              {assignment.isPublished ? 'Published' : 'Draft'}
            </Badge>
            {assignment.scope === 'BATCH' && (
              <Badge
                variant="outline"
                className="gap-1 border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700"
              >
                <Layers className="h-2.5 w-2.5" />
                Batch only{assignment.batch ? ` · ${assignment.batch.name}` : ''}
              </Badge>
            )}
            {!assignment.allowResubmission && (
              <Badge variant="outline" className="text-[10px] text-gray-500">
                One attempt
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>{assignment.maxMarks} marks</span>
            <span
              className={cn(
                'flex items-center gap-1',
                overdue && 'font-medium text-amber-700'
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {overdue ? 'Closed' : 'Due'} {due.toLocaleString()}
            </span>
          </div>

          {overdue && !assignment.isPublished && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              The deadline has passed, so this draft cannot be published. Move the deadline
              forward first.
            </p>
          )}
        </div>

        {/* The way in to grading. Shown regardless of `canEdit`, because
            instructors see this row read-only but are exactly the people who
            mark the work — the API authorises admins and instructors alike. */}
        {assignment.isPublished && (
          <Button variant="outline" size="sm" asChild className="h-8 flex-shrink-0">
            <Link to={`/instructor/assignments/${assignment.id}`}>
              <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
              Evaluate
            </Link>
          </Button>
        )}

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 flex-shrink-0 p-0">
                <span className="sr-only">Actions for {assignment.title}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(assignment)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>

              {!assignment.isPublished ? (
                <DropdownMenuItem
                  onClick={() => setPublished.mutate(true)}
                  disabled={setPublished.isPending || overdue}
                >
                  <Send className="mr-2 h-4 w-4 text-green-600" />
                  Publish &amp; notify
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => setPublished.mutate(false)}
                  disabled={setPublished.isPending}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Withdraw
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmingDelete(true)}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Confirmed rather than immediate, unlike content: deleting a published
          assignment also removes any work students have already handed in. */}
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{assignment.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {assignment.isPublished
                ? 'This assignment is published. Deleting it also deletes any submissions students have already made, along with their marks. This cannot be undone.'
                : 'This draft has never been visible to students. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
