import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { uploadFile, type LmsModule, type ModuleDifficulty } from '@/services/lms';

const schema = z.object({
  name: z.string().trim().min(2, 'Module name must be at least 2 characters'),
  description: z.string().trim().max(2000).optional(),
  estimatedDurationMinutes: z
    .union([z.coerce.number().int().min(1, 'Must be at least 1 minute'), z.literal('')])
    .optional(),
  difficulty: z.string().optional(),
  isVisible: z.boolean().optional(),
});

export type ModuleFormValues = z.infer<typeof schema>;

const NONE = '__none__';

const DIFFICULTIES: { value: ModuleDifficulty; label: string }[] = [
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
];

/**
 * Create/edit a module.
 *
 * Duration and difficulty are descriptive metadata — nothing gates access on
 * them, which the copy says explicitly so an admin does not expect enforcement
 * that is not there.
 */
export function ModuleFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    name: string;
    description?: string;
    estimatedDurationMinutes?: number;
    difficulty?: ModuleDifficulty;
    isVisible?: boolean;
    thumbnailAssetId?: string | null;
  }) => void;
  initialData?: LmsModule | null;
  isLoading: boolean;
}) {
  const isEditing = !!initialData;

  // Thumbnail lives outside react-hook-form: it is an async upload producing an
  // asset id, not a text field, and mixing the two makes the reset logic murky.
  const [thumbnail, setThumbnail] = useState<{ id: string; url: string } | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ModuleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', estimatedDurationMinutes: '', difficulty: NONE, isVisible: true },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: initialData?.name ?? '',
      description: initialData?.description ?? '',
      estimatedDurationMinutes: initialData?.estimatedDurationMinutes ?? '',
      difficulty: initialData?.difficulty ?? NONE,
      isVisible: initialData?.isVisible ?? true,
    });
    setThumbnail(
      initialData?.thumbnail ? { id: initialData.thumbnail.id, url: initialData.thumbnail.url } : null
    );
    setUploadPercent(null);
    setUploadError(null);
  }, [open, initialData, reset]);

  const handleThumbnail = async (file: File) => {
    setUploadError(null);
    setUploadPercent(0);
    try {
      // The Phase 1 signed-upload path, unchanged — thumbnails are ordinary
      // content uploads, so there is no second storage code path to maintain.
      const asset = await uploadFile(file, 'content', setUploadPercent);
      setThumbnail({ id: asset.id, url: asset.url });
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploadPercent(null);
    }
  };

  const submit = (values: ModuleFormValues) => {
    onSubmit({
      name: values.name,
      description: values.description || undefined,
      estimatedDurationMinutes:
        values.estimatedDurationMinutes === '' || values.estimatedDurationMinutes === undefined
          ? undefined
          : Number(values.estimatedDurationMinutes),
      difficulty:
        values.difficulty && values.difficulty !== NONE
          ? (values.difficulty as ModuleDifficulty)
          : undefined,
      ...(isEditing ? { isVisible: values.isVisible } : {}),
      // null explicitly clears an existing thumbnail; the service distinguishes
      // null from undefined.
      thumbnailAssetId: thumbnail?.id ?? null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Module' : 'Add Module'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update this module’s details.'
              : 'Modules group the notes, videos and resources of a curriculum.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="space-y-4 pt-2" noValidate>
          <div className="space-y-2">
            <Label htmlFor="module-name">Module Name</Label>
            <Input id="module-name" placeholder="e.g. React" {...register('name')} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="module-description">Description</Label>
            <Textarea
              id="module-description"
              rows={3}
              placeholder="What this module covers…"
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="module-duration">Estimated Duration</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="module-duration"
                  type="number"
                  min={1}
                  placeholder="480"
                  {...register('estimatedDurationMinutes')}
                />
                <span className="whitespace-nowrap text-xs text-gray-500">min</span>
              </div>
              {errors.estimatedDurationMinutes && (
                <p className="text-xs text-red-500">{errors.estimatedDurationMinutes.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="module-difficulty">Difficulty</Label>
              <Controller
                control={control}
                name="difficulty"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || NONE}>
                    <SelectTrigger id="module-difficulty">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {DIFFICULTIES.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <p className="rounded-md border border-blue-100 bg-blue-50 p-2.5 text-xs leading-relaxed text-blue-900">
            Duration and difficulty are shown to students for guidance only. Every module is
            accessible immediately — nothing is locked behind another.
          </p>

          {isEditing && (
            <Controller
              control={control}
              name="isVisible"
              render={({ field }) => (
                <div className="flex items-start gap-2.5 rounded-md border p-3">
                  <Checkbox
                    id="module-visible"
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                  />
                  <div>
                    <Label htmlFor="module-visible" className="cursor-pointer text-sm font-medium">
                      Visible to students
                    </Label>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Hidden modules stay editable but disappear from the student view.
                    </p>
                  </div>
                </div>
              )}
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Module'}
            </Button>
          </div>
        
          {/* --- Thumbnail (Phase 2) --- */}
          <div className="space-y-2">
            <Label>Thumbnail</Label>
            <div className="flex items-center gap-3">
              {thumbnail ? (
                <img
                  src={thumbnail.url}
                  alt=""
                  className="h-16 w-24 rounded border object-cover"
                />
              ) : (
                <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed bg-gray-50 text-xs text-gray-400">
                  No image
                </div>
              )}

              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="h-9 text-xs"
                    disabled={uploadPercent !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleThumbnail(file);
                      // Reset so re-picking the same file fires change again.
                      e.target.value = '';
                    }}
                  />
                  {thumbnail && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setThumbnail(null)}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                {uploadPercent !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${uploadPercent}%` }}
                    />
                  </div>
                )}
                {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
              </div>
            </div>
          </div>
</form>
      </DialogContent>
    </Dialog>
  );
}
