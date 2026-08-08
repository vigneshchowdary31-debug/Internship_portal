import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  Loader2,
  Upload,
  Download,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { quizzesApi, type QuestionImportResult } from '@/services/quizzes';

/**
 * Bulk question import.
 *
 * ── PARTIAL SUCCESS IS THE NORMAL OUTCOME ────────────────────────────────────
 * The server answers 200 even when rows were rejected, because the rows that
 * passed WERE imported. So this reads `imported`/`failed` and never the status
 * code, and on a partial result it keeps the dialog open showing exactly which
 * lines failed and why — an admin who pasted forty questions needs the list of
 * the three to fix, not "something went wrong".
 *
 * The rejected rows download as CSV so they can be corrected and re-uploaded,
 * rather than hunted for by eye in the original file.
 */

/** 2 MB, matching the route's body parser. Checked here to save the round trip. */
const MAX_BYTES = 2 * 1024 * 1024;

export function QuestionCsvDialog({
  quizId,
  open,
  onOpenChange,
  onImported,
}: {
  quizId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<QuestionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFilename(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const upload = useMutation({
    mutationFn: (csv: string) => quizzesApi.uploadCsv(quizId, csv),
    onSuccess: (imported) => {
      setResult(imported);
      // Refresh regardless: even a partial import added questions.
      onImported();

      if (imported.failed === 0) {
        toast.success(`Imported ${imported.imported} question(s)`);
        onOpenChange(false);
        reset();
      }
    },
    onError: (err) => {
      // A whole-file rejection: bad headers, an empty file, or a quiz that has
      // already been attempted. One clear message, no per-row detail to show.
      setError(errorMessage(err));
      setResult(null);
    },
  });

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);

    if (file.size === 0) return setError('That file is empty.');
    if (file.size > MAX_BYTES) {
      return setError('That file is larger than 2 MB. Split it into smaller batches.');
    }

    setFilename(file.name);
    upload.mutate(await file.text());
  };

  const downloadTemplate = async () => {
    try {
      const csv = await quizzesApi.questionTemplate();
      triggerDownload(csv, 'quiz-questions-template.csv');
    } catch (err) {
      toast.error('Could not download the template', errorMessage(err));
    }
  };

  const downloadRejected = () => {
    if (!result?.rejected.length) return;
    const rows = [
      ['row', 'question', 'reason'],
      ...result.rejected.map((r) => [String(r.row), r.question, r.reason]),
    ];
    triggerDownload(rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'rejected-questions.csv');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Import questions from CSV</DialogTitle>
          <DialogDescription>
            Rows are validated one at a time — valid questions import even if others fail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Format, stated up front. `correctOption` being a 1-based index is
              the thing people get wrong, so it is spelled out rather than
              discovered from a rejection. */}
          <div className="rounded-md border bg-gray-50 p-3 text-xs text-gray-600">
            <p className="font-medium text-gray-900">Expected columns</p>
            <code className="mt-1 block break-all text-[11px]">
              question,option1,option2,option3,option4,correctOption,marks
            </code>
            <ul className="mt-2 list-inside list-disc space-y-0.5">
              <li>
                <strong>correctOption</strong> is the option NUMBER (1–4), not the answer text
              </li>
              <li>At least two options; fill them left to right</li>
              <li>
                <strong>marks</strong> is optional and defaults to 1
              </li>
            </ul>
            <Button variant="outline" size="sm" className="mt-2" onClick={downloadTemplate}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download template
            </Button>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />

          {filename && !error ? (
            <div className="flex items-center gap-3 rounded-md border bg-white p-3">
              <FileCheck2 className="h-5 w-5 flex-shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{filename}</span>
              {!upload.isPending && (
                <Button variant="ghost" size="sm" onClick={reset} className="h-8">
                  <X className="mr-1 h-3.5 w-3.5" />
                  Change
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              disabled={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Choose a CSV file
            </Button>
          )}

          {upload.isPending && (
            <p className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing…
            </p>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {error}
            </p>
          )}

          {result && result.failed > 0 && (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Imported {result.imported} of {result.totalRows} — {result.failed} rejected
              </p>

              <div className="max-h-52 space-y-1.5 overflow-y-auto">
                {result.rejected.map((row) => (
                  <div key={row.row} className="rounded border border-amber-200 bg-white p-2 text-xs">
                    <p className="font-medium text-gray-900">
                      Line {row.row}
                      {row.question ? `: ${row.question}` : ''}
                    </p>
                    <p className="mt-0.5 text-red-700">{row.reason}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={downloadRejected}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download rejected rows
                </Button>
                <Button variant="outline" size="sm" onClick={reset}>
                  Upload a corrected file
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {result && result.failed > 0 ? 'Done' : 'Cancel'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Minimal CSV quoting for the rejected-rows download. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function triggerDownload(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
