import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CalendarClock } from 'lucide-react';
import type { Assignment, AssignmentPayload } from '@/services/assignments';

/**
 * Create/edit an assignment.
 *
 * Deliberately NOT part of the content dialog. An assignment is a distinct
 * backend entity with a deadline, a mark and submissions — none of which a
 * `Content` row has — and the server would reject it on the content endpoint
 * for carrying neither a file nor a URL.
 *
 * Validation mirrors the server's rather than trusting it silently: a deadline
 * in the past is refused here so the admin finds out while the form is still in
 * front of them, and refused again server-side because a client is never the
 * enforcement point.
 */

/** `datetime-local` needs a local-time string, not a UTC ISO string. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Two weeks out, rounded to the hour — a sane default nobody has to retype. */
function defaultDeadline(): string {
  const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d.toISOString());
}

export function AssignmentFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AssignmentPayload) => void;
  initialData?: Assignment | null;
  isLoading: boolean;
}) {
  const isEditing = !!initialData;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxMarks, setMaxMarks] = useState('100');
  const [deadline, setDeadline] = useState('');
  const [allowResubmission, setAllowResubmission] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialData?.title ?? '');
    setDescription(initialData?.description ?? '');
    setMaxMarks(String(initialData?.maxMarks ?? 100));
    setDeadline(initialData ? toLocalInput(initialData.deadline) : defaultDeadline());
    setAllowResubmission(initialData?.allowResubmission ?? true);
    setError(null);
  }, [open, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (title.trim().length < 2) {
      return setError('Give the assignment a title of at least 2 characters.');
    }
    if (!description.trim()) {
      return setError('Describe what students have to do.');
    }

    const marks = Number(maxMarks);
    if (!Number.isInteger(marks) || marks < 1 || marks > 1000) {
      return setError('Marks must be a whole number between 1 and 1000.');
    }

    if (!deadline) return setError('Set a deadline.');
    const due = new Date(deadline);
    if (Number.isNaN(due.getTime())) return setError('That deadline is not a valid date.');
    if (due.getTime() <= Date.now()) {
      // The server refuses this too. Catching it here means the admin does not
      // lose the form to a round trip that was always going to fail.
      return setError('The deadline must be in the future.');
    }

    onSubmit({
      title: title.trim(),
      description: description.trim(),
      maxMarks: marks,
      deadline: due.toISOString(),
      allowResubmission,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit assignment' : 'New assignment'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Changes apply immediately. Extending the deadline also un-flags anyone who was marked late.'
              : 'Saved as a draft. Students see nothing until you publish it.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assignment-title">Title</Label>
            <Input
              id="assignment-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Build a REST API"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignment-description">Instructions</Label>
            <Textarea
              id="assignment-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should students build, and what should they hand in?"
              rows={6}
              maxLength={8000}
            />
            <p className="text-xs text-gray-500">
              {description.length}/8000 characters
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="assignment-marks">Maximum marks</Label>
              <Input
                id="assignment-marks"
                type="number"
                min={1}
                max={1000}
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assignment-deadline" className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Deadline
              </Label>
              <Input
                id="assignment-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-md border bg-gray-50 p-3">
            <Checkbox
              checked={allowResubmission}
              onCheckedChange={(v) => setAllowResubmission(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium text-gray-900">Allow resubmission</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                Students can replace their file until it has been marked. Turn this off for
                one-shot work.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save changes' : 'Create draft'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
