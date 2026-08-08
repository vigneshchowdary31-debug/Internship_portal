import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Timer, Repeat } from 'lucide-react';
import { lmsApi } from '@/services/lms';
import type { Quiz, QuizPayload } from '@/services/quizzes';

/**
 * Create/edit a quiz.
 *
 * ── WHY THERE IS A MODULE PICKER ────────────────────────────────────────────
 * `moduleId` is REQUIRED by POST /api/quizzes — a quiz belongs to a module the
 * same way content and assignments do, which is what makes it visible to the
 * right students at all. A form with only title/duration/attempts could not
 * create one. Two cascading selects (learning path, then module) are the
 * smallest thing that supplies it.
 *
 * The module cannot be changed after creation: the server denormalises
 * `learningPathId` from it and student visibility resolves against that, so
 * moving a quiz between curricula is a different operation from editing one.
 */
export function QuizFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `moduleId` is null when editing — the server ignores it there. */
  onSubmit: (values: QuizPayload & { moduleId: string }) => void;
  initialData?: Quiz | null;
  isLoading: boolean;
}) {
  const isEditing = !!initialData;

  const [pathId, setPathId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimit, setTimeLimit] = useState('30');
  /** '' = server default (one attempt), 'unlimited', or a number. */
  const [attempts, setAttempts] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const { data: paths = [] } = useQuery({
    queryKey: ['lms', 'paths', 'all'],
    queryFn: () => lmsApi.listPaths(),
    enabled: open && !isEditing,
  });

  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ['lms', 'modules', pathId],
    queryFn: () => lmsApi.listModules(pathId),
    enabled: open && !isEditing && !!pathId,
  });

  useEffect(() => {
    if (!open) return;
    setTitle(initialData?.title ?? '');
    setDescription(initialData?.description ?? '');
    setTimeLimit(String(initialData?.timeLimit ?? 30));
    setAttempts(
      initialData ? (initialData.maxAttempts === null ? 'unlimited' : String(initialData.maxAttempts)) : '1'
    );
    setPathId('');
    setModuleId(initialData?.moduleId ?? '');
    setError(null);
  }, [open, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isEditing && !moduleId) return setError('Choose the module this quiz belongs to.');
    if (title.trim().length < 2) return setError('Give the quiz a title of at least 2 characters.');

    const minutes = Number(timeLimit);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return setError('The time limit must be a whole number of minutes between 1 and 1440.');
    }

    let maxAttempts: number | null | undefined;
    if (attempts === 'unlimited') maxAttempts = null;
    else {
      const parsed = Number(attempts);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return setError('Attempts must be a whole number between 1 and 100, or unlimited.');
      }
      maxAttempts = parsed;
    }

    onSubmit({
      moduleId,
      title: title.trim(),
      description: description.trim() || null,
      timeLimit: minutes,
      maxAttempts,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit quiz' : 'New quiz'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Students see changes immediately. Questions are managed separately.'
              : 'Saved as a draft. Add questions, then publish — a quiz with none cannot be published.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEditing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Curriculum</Label>
                <Select
                  value={pathId}
                  onValueChange={(v) => {
                    setPathId(v);
                    setModuleId(''); // The old module belongs to the old path.
                  }}
                >
                  <SelectTrigger aria-label="Learning path">
                    <SelectValue placeholder="Choose a path" />
                  </SelectTrigger>
                  <SelectContent>
                    {paths.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Module</Label>
                <Select value={moduleId} onValueChange={setModuleId} disabled={!pathId}>
                  <SelectTrigger aria-label="Module">
                    <SelectValue placeholder={pathId ? 'Choose a module' : 'Pick a path first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingModules ? (
                      <div className="px-2 py-1.5 text-sm text-gray-500">Loading…</div>
                    ) : modules.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-gray-500">No modules yet</div>
                    ) : (
                      modules.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="quiz-title">Title</Label>
            <Input
              id="quiz-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="React Fundamentals"
              maxLength={200}
              autoFocus={isEditing}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-description">Description</Label>
            <Textarea
              id="quiz-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this quiz cover? Optional."
              rows={3}
              maxLength={8000}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quiz-time" className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" />
                Time limit (minutes)
              </Label>
              <Input
                id="quiz-time"
                type="number"
                min={1}
                max={1440}
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                The clock starts when a student begins, and is pinned then — editing this later
                never moves a running clock.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quiz-attempts" className="flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" />
                Attempts allowed
              </Label>
              <Select value={attempts} onValueChange={setAttempts}>
                <SelectTrigger id="quiz-attempts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (single attempt)</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="unlimited">Unlimited</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Only completed attempts count, so walking away cannot reset the clock.
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
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
