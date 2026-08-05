import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
import { useToast, errorMessage } from '@/components/ui/toast';
import { Loader2, GitBranch, Info } from 'lucide-react';
import { lmsApi, type LearningPath } from '@/services/lms';

/**
 * Create a learning path, or clone an existing one into a new version.
 *
 * Cloning is the mechanism that makes curriculum versioning work without
 * migrations: it deep-copies modules and content, carrying the lineage so a
 * transferred student's completed work still counts toward equivalent modules.
 */
export function LearningPathDialog({
  open,
  onOpenChange,
  mode,
  techStackId,
  sourcePath,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'clone';
  techStackId: string;
  sourcePath: LearningPath | null;
  onCreated: (path: LearningPath) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClone = mode === 'clone';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setIsDefault(false);
    if (isClone && sourcePath) {
      // Suggest a sensible next version so the admin usually just confirms.
      setName(sourcePath.name.replace(/\s*\d{4}\s*$/, '').trim() || sourcePath.name);
      setVersion('');
      setDescription(sourcePath.description ?? '');
    } else {
      setName('');
      setVersion('');
      setDescription('');
    }
  }, [open, isClone, sourcePath]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), version: version.trim(), description: description.trim() || undefined };
      return isClone && sourcePath
        ? lmsApi.clonePath(sourcePath.id, body)
        : lmsApi.createPath({ ...body, techStackId, isDefault });
    },
    onSuccess: (path) => {
      toast.success(
        isClone ? 'Curriculum cloned' : 'Learning path created',
        isClone ? 'It starts as a draft — publish when ready.' : undefined
      );
      onCreated(path);
    },
    onError: (err) => {
      const message = errorMessage(err);
      setError(message);
      toast.error(isClone ? 'Could not clone' : 'Could not create', message);
    },
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) return setError('A name of at least 2 characters is required.');
    if (!version.trim()) return setError('A version label is required, for example "2027".');
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isClone && <GitBranch className="h-5 w-5 text-primary" />}
            {isClone ? 'Clone Curriculum Version' : 'New Learning Path'}
          </DialogTitle>
          <DialogDescription>
            {isClone
              ? `Copies every module and item from "${sourcePath?.name} ${sourcePath?.version}" into a new version.`
              : 'A versioned curriculum. Batches are pinned to the version they were assigned.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {error && (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {isClone && (
            <div className="flex items-start gap-2.5 rounded-md border border-blue-100 bg-blue-50 p-3">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-blue-900">
                Batches on the existing version keep it, untouched. Batch-specific overrides are not
                copied — only the shared curriculum. The clone starts as a draft.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="path-name">Name</Label>
            <Input
              id="path-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MERN"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="path-version">Version</Label>
            <Input
              id="path-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 2027"
            />
            <p className="text-xs text-gray-500">
              Must be unique for this tech stack. Students see “{name || 'MERN'} · {version || '2027'}”.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="path-description">Description</Label>
            <Textarea
              id="path-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What changed in this version…"
            />
          </div>

          {!isClone && (
            <div className="flex items-start gap-2.5 rounded-md border p-3">
              <Checkbox
                id="path-default"
                checked={isDefault}
                onCheckedChange={(v) => setIsDefault(v === true)}
              />
              <div>
                <Label htmlFor="path-default" className="cursor-pointer text-sm font-medium">
                  Make this the default
                </Label>
                <p className="mt-0.5 text-xs text-gray-500">
                  New batches for this tech stack will use it unless another is chosen.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isClone ? 'Clone Version' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
