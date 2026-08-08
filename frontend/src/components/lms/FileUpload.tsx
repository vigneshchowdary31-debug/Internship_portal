import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, FileCheck2, X, AlertTriangle } from 'lucide-react';
import { uploadToProvider, type ProviderUpload } from '@/services/lms';

/**
 * Picks a file and uploads it directly to the storage provider.
 *
 * The file NEVER passes through our own API: this asks the server for a signed
 * ticket, POSTs the bytes straight to Cloudinary, and hands the provider's
 * response back to the parent. That is what keeps `express.json({ limit:
 * '10kb' })` viable alongside 25 MB submissions.
 *
 * Uploading and submitting are separate on purpose. This component finishes the
 * moment the provider accepts the file; the parent then decides what to do with
 * the result. If the submission call fails afterwards, the parent still holds a
 * valid `ProviderUpload` and can retry WITHOUT making the student upload a
 * 25 MB file a second time.
 */

/** Mirrors UPLOAD_LIMITS.submission on the server, so the rejection is instant. */
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED_MIME = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'image/png',
  'image/jpeg',
  'text/plain',
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({
  onUploaded,
  onCleared,
  disabled = false,
  uploadedFilename,
}: {
  onUploaded: (upload: ProviderUpload) => void;
  onCleared: () => void;
  disabled?: boolean;
  /** Set by the parent once an upload has succeeded, so this can show it. */
  uploadedFilename?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
    onCleared();
  };

  const handleFile = async (file: File) => {
    setError(null);

    // Checked here as well as on the server: rejecting a 40 MB file before it
    // is uploaded saves the student the entire transfer.
    if (file.size === 0) return setError('That file is empty.');
    if (file.size > MAX_BYTES) {
      return setError(
        `That file is ${formatSize(file.size)}. The limit for submissions is ${formatSize(MAX_BYTES)}.`
      );
    }
    if (file.type && !ACCEPTED_MIME.includes(file.type)) {
      return setError(
        `Files of type "${file.type}" are not accepted. Upload a PDF, ZIP, PNG, JPEG or text file.`
      );
    }

    setUploading(true);
    setProgress(0);
    try {
      const upload = await uploadToProvider(file, 'submission', setProgress);
      onUploaded(upload);
    } catch (err) {
      // The provider rejected it, the connection dropped, or Cloudinary
      // returned an unusable resource_type. All three leave nothing registered,
      // so retrying is simply picking the file again.
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      if (inputRef.current) inputRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  if (uploadedFilename) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-3">
        <FileCheck2 className="h-5 w-5 flex-shrink-0 text-green-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-green-900">{uploadedFilename}</p>
          <p className="text-xs text-green-700">Uploaded and ready to submit.</p>
        </div>
        {!disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={reset} className="h-8">
            <X className="mr-1 h-3.5 w-3.5" />
            Change
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_MIME.join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Uploading… {progress}%
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            Choose a file
          </>
        )}
      </Button>

      {uploading && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {!uploading && (
        <p className="text-xs text-gray-500">
          PDF, ZIP, PNG, JPEG or text · up to {formatSize(MAX_BYTES)}
        </p>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
