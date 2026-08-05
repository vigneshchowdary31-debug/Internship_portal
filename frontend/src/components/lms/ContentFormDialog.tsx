import { useEffect, useRef, useState } from 'react';
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
import { useToast, errorMessage } from '@/components/ui/toast';
import { Loader2, Upload, FileCheck2, X, CalendarClock } from 'lucide-react';
import {
  ASSET_CONTENT_TYPES,
  EITHER_CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  URL_CONTENT_TYPES,
  uploadFile,
  type ContentType,
  type LmsContent,
} from '@/services/lms';

/**
 * Create/edit a content item.
 *
 * The payload field switches on type: file-backed types get an uploader,
 * link-backed types get a URL field. Validation is done here rather than with a
 * schema because the required field is genuinely conditional and the server
 * enforces the same rule anyway.
 */

export interface ContentFormValues {
  title: string;
  description?: string;
  type: ContentType;
  assetId?: string | null;
  externalUrl?: string | null;
  releaseAt?: string | null;
}

const ALL_TYPES: ContentType[] = [
  ...ASSET_CONTENT_TYPES,
  ...URL_CONTENT_TYPES,
  ...EITHER_CONTENT_TYPES,
];

/** `datetime-local` needs a local-time string, not a UTC ISO string. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function ContentFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ContentFormValues) => void;
  initialData?: LmsContent | null;
  isLoading: boolean;
}) {
  const isEditing = !!initialData;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ContentType>('PDF');
  const [externalUrl, setExternalUrl] = useState('');
  const [releaseAt, setReleaseAt] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assetName, setAssetName] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialData?.title ?? '');
    setDescription(initialData?.description ?? '');
    setType(initialData?.type ?? 'PDF');
    setExternalUrl(initialData?.externalUrl ?? '');
    setReleaseAt(toLocalInput(initialData?.releaseAt));
    setAssetId(initialData?.asset?.id ?? null);
    setAssetName(initialData?.asset?.originalFilename ?? null);
    setUploadPercent(null);
    setError(null);
  }, [open, initialData]);

  // Reference material accepts either payload, so both inputs are shown and
  // neither is individually required — only that one of them is filled.
  const acceptsEither = EITHER_CONTENT_TYPES.includes(type);
  const needsAsset = ASSET_CONTENT_TYPES.includes(type);
  const needsUrl = URL_CONTENT_TYPES.includes(type);
  const showAsset = needsAsset || acceptsEither;
  const showUrl = needsUrl || acceptsEither;

  const handleFile = async (file: File) => {
    setError(null);
    setUploadPercent(0);
    try {
      const asset = await uploadFile(file, 'content', setUploadPercent);
      setAssetId(asset.id);
      setAssetName(asset.originalFilename);
      toast.success('File uploaded', asset.originalFilename);
    } catch (err) {
      setError(errorMessage(err, 'Upload failed.'));
    } finally {
      setUploadPercent(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = () => {
    setError(null);

    if (title.trim().length < 2) return setError('A title of at least 2 characters is required.');
    if (needsAsset && !assetId) return setError(`A ${CONTENT_TYPE_LABELS[type]} needs an uploaded file.`);
    if (needsUrl && !externalUrl.trim()) return setError(`A ${CONTENT_TYPE_LABELS[type]} needs a URL.`);
    if (acceptsEither && !assetId && !externalUrl.trim()) {
      return setError('Reference material needs either an uploaded file or a URL.');
    }

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      assetId: showAsset ? assetId : null,
      externalUrl: showUrl && externalUrl.trim() ? externalUrl.trim() : null,
      // datetime-local yields local time; convert to a real instant.
      releaseAt: releaseAt ? new Date(releaseAt).toISOString() : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Content' : 'Add Content'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update this resource. The type cannot be changed after creation.'
              : 'Add notes, a presentation, a repository or a class recording to this module.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {error && (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="content-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ContentType)}
              disabled={isEditing}
            >
              <SelectTrigger id="content-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CONTENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content-title">Title</Label>
            <Input
              id="content-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. useEffect and the dependency array"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content-description">Description</Label>
            <Textarea
              id="content-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for students…"
            />
          </div>

          {showAsset && (
            <div className="space-y-2">
              <Label>File</Label>
              {assetId && assetName ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 p-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-green-900">
                    <FileCheck2 className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{assetName}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAssetId(null);
                      setAssetName(null);
                    }}
                    aria-label="Remove file"
                    className="rounded p-0.5 text-green-700 hover:text-green-900"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : uploadPercent !== null ? (
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-gray-600">
                    <span>Uploading…</span>
                    <span>{uploadPercent}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-all"
                      style={{ width: `${uploadPercent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="content-file"
                  className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center transition-colors hover:border-primary hover:bg-gray-100"
                >
                  <Upload className="h-6 w-6 text-gray-400" aria-hidden="true" />
                  <span className="text-sm font-medium text-gray-700">Choose a file</span>
                  <span className="text-xs text-gray-500">Uploads directly, up to 50 MB</span>
                  <input
                    ref={fileRef}
                    id="content-file"
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {showUrl && (
            <div className="space-y-2">
              <Label htmlFor="content-url">
                {type === 'GITHUB_REPO' ? 'Repository URL' : type === 'RECORDING' ? 'Recording URL' : 'URL'}
              </Label>
              <Input
                id="content-url"
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder={
                  type === 'GITHUB_REPO'
                    ? 'https://github.com/org/repo'
                    : 'https://drive.google.com/…'
                }
              />
              {type === 'RECORDING' && (
                <p className="text-xs text-gray-500">
                  Paste the Meet recording link. Automatic capture comes later.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="content-release" className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule Release
            </Label>
            <Input
              id="content-release"
              type="datetime-local"
              value={releaseAt}
              onChange={(e) => setReleaseAt(e.target.value)}
            />
            <p className="text-xs text-gray-500">
              Leave empty to release as soon as it is published. Students never see it before this
              moment.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={isLoading || uploadPercent !== null}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Content'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
