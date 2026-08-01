import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
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
  Download,
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Check,
  Mail,
} from 'lucide-react';
import type { EnrollmentRole } from './UserFormDialog';

/**
 * Five-step bulk enrollment wizard.
 *
 *   1 Upload → 2 Validation → 3 Preview → 4 Import → 5 Result
 *
 * Validation is a server-side dry run: only the backend can check uniqueness
 * against the database or resolve tech stack names, so validating in the
 * browser would produce a preview that disagrees with the import.
 *
 * The raw file text is held in state and posted twice — once to validate, once
 * to import — because the two are separate requests and the database can change
 * in between. The server re-validates on import for the same reason.
 */

const STEPS = ['Upload', 'Validation', 'Preview', 'Import', 'Result'] as const;
type Step = 0 | 1 | 2 | 3 | 4;

const MAX_FILE_BYTES = 2 * 1024 * 1024; // matches the server's 2mb body limit

interface ValidatedRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  name: string;
  email: string;
  niatId?: string;
  universityName?: string;
  employeeId?: string;
  techStackName: string;
}

interface ValidationReport {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ValidatedRow[];
}

interface ImportReport {
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  emailsSent: number;
  emailsFailed: number;
  errors: { rowNumber: number; email: string; message: string }[];
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: EnrollmentRole;
}

/** Triggers a browser download for text produced client-side or by the API. */
function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function CsvImportDialog({ open, onOpenChange, role }: CsvImportDialogProps) {
  const isStudent = role === 'STUDENT';
  const slug = isStudent ? 'students' : 'instructors';
  const noun = isStudent ? 'student' : 'instructor';

  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(0);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setStep(0);
    setFileName('');
    setCsvText('');
    setReport(null);
    setResult(null);
    setError(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const downloadTemplate = async () => {
    try {
      const res = await api.get(`/users/import/${slug}/template`, { responseType: 'text' });
      downloadText(`${slug}-import-template.csv`, res.data);
    } catch (err) {
      toast.error('Could not download template', errorMessage(err));
    }
  };

  /** Step 1 → 2: read the file locally, then have the server validate it. */
  const handleFile = async (file: File) => {
    setError(null);

    if (!/\.csv$/i.test(file.name)) {
      setError('Please choose a .csv file.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is larger than 2 MB. Please split it into smaller files.');
      return;
    }
    if (file.size === 0) {
      setError('That file is empty.');
      return;
    }

    setFileName(file.name);
    setStep(1);
    setBusy(true);

    try {
      const text = await file.text();
      setCsvText(text);

      const res = await api.post(`/users/import/${slug}/validate`, text, {
        headers: { 'Content-Type': 'text/csv' },
      });
      setReport(res.data.data as ValidationReport);
      setStep(2);
    } catch (err) {
      setError(errorMessage(err, 'Could not read that file.'));
      setStep(0);
    } finally {
      setBusy(false);
    }
  };

  /** Step 3 → 4 → 5. */
  const runImport = async () => {
    setStep(3);
    setBusy(true);
    setError(null);

    try {
      const res = await api.post(`/users/import/${slug}`, csvText, {
        headers: { 'Content-Type': 'text/csv' },
      });
      const imported = res.data.data as ImportReport;
      setResult(imported);
      setStep(4);

      // Both list views key off role, so refresh whichever is on screen.
      queryClient.invalidateQueries({ queryKey: ['users'] });

      if (imported.imported > 0) {
        toast.success(
          `${imported.imported} ${noun}${imported.imported === 1 ? '' : 's'} enrolled`,
          `${imported.emailsSent} enrollment email(s) sent.`
        );
      } else {
        toast.error('Nothing was imported', 'Every row was skipped or failed.');
      }
    } catch (err) {
      const message = errorMessage(err, 'The import failed.');
      setError(message);
      toast.error('Import failed', message);
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  const downloadFailedRows = async () => {
    try {
      const res = await api.post(`/users/import/${slug}/failed-rows`, csvText, {
        headers: { 'Content-Type': 'text/csv' },
        responseType: 'text',
      });
      downloadText(`${slug}-failed-rows.csv`, res.data);
    } catch (err) {
      toast.error('Could not download failed rows', errorMessage(err));
    }
  };

  const columns = isStudent
    ? ['Row', 'Name', 'Email', 'NIAT ID', 'University', 'Tech Stack', 'Status']
    : ['Row', 'Name', 'Email', 'Employee ID', 'Tech Stack', 'Status'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {isStudent ? 'Students' : 'Instructors'} from CSV</DialogTitle>
          <DialogDescription>
            Bulk-enroll {noun}s. Each imported {noun} receives a generated password by email.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <ol className="flex items-center gap-1 py-3" aria-label="Import progress">
          {STEPS.map((label, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <li key={label} className="flex flex-1 items-center gap-1">
                <div className="flex flex-col items-center gap-1">
                  <span
                    aria-current={active ? 'step' : undefined}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                      done
                        ? 'bg-green-600 text-white'
                        : active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span
                    className={`hidden text-[11px] sm:block ${
                      active ? 'font-semibold text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`h-px flex-1 ${done ? 'bg-green-600' : 'bg-gray-200'}`} />
                )}
              </li>
            );
          })}
        </ol>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------- Step 1: Upload ---------- */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="rounded-md border border-blue-100 bg-blue-50 p-4">
              <p className="mb-2 text-sm font-medium text-blue-900">
                Start from the template
              </p>
              <p className="mb-3 text-xs leading-relaxed text-blue-800">
                Required columns:{' '}
                <span className="font-mono">
                  {isStudent
                    ? 'Name, Email, NIAT ID, University Name, Tech Stack'
                    : 'Name, Email, Employee ID, Tech Stack'}
                </span>
                . Tech Stack must match an existing stack name exactly. Maximum 500 rows.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Download CSV template
              </Button>
            </div>

            <label
              htmlFor="csv-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-10 text-center transition-colors hover:border-primary hover:bg-gray-100"
            >
              <Upload className="h-8 w-8 text-gray-400" aria-hidden="true" />
              <span className="text-sm font-medium text-gray-700">
                Click to choose a CSV file
              </span>
              <span className="text-xs text-gray-500">.csv only, up to 2 MB</span>
              <input
                ref={fileInputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
          </div>
        )}

        {/* ---------- Step 2: Validating ---------- */}
        {step === 1 && (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-gray-700">Validating {fileName}…</p>
            <p className="text-xs text-gray-500">
              Checking required fields, duplicates and tech stacks.
            </p>
          </div>
        )}

        {/* ---------- Step 3: Preview ---------- */}
        {step === 2 && report && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border bg-white p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{report.totalRows}</p>
                <p className="text-xs text-gray-500">Total rows</p>
              </div>
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{report.validRows}</p>
                <p className="text-xs text-green-600">Valid</p>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{report.invalidRows}</p>
                <p className="text-xs text-red-600">Invalid</p>
              </div>
            </div>

            {report.invalidRows > 0 && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <p className="text-xs leading-relaxed text-amber-900">
                    {report.invalidRows} row(s) will be skipped. The {report.validRows} valid row(s)
                    will still be imported.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={downloadFailedRows}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Failed rows
                </Button>
              </div>
            )}

            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b bg-gray-50 text-gray-600">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.rows.map((row) => (
                    <tr key={row.rowNumber} className={row.valid ? '' : 'bg-red-50/60'}>
                      <td className="px-3 py-2 text-gray-400">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{row.name || '—'}</td>
                      <td className="px-3 py-2">{row.email || '—'}</td>
                      {isStudent ? (
                        <>
                          <td className="px-3 py-2">{row.niatId || '—'}</td>
                          <td className="px-3 py-2">{row.universityName || '—'}</td>
                        </>
                      ) : (
                        <td className="px-3 py-2">{row.employeeId || '—'}</td>
                      )}
                      <td className="px-3 py-2">{row.techStackName || '—'}</td>
                      <td className="px-3 py-2">
                        {row.valid ? (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Valid
                          </span>
                        ) : (
                          <span className="inline-flex items-start gap-1 text-red-700">
                            <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span>{row.errors.join('; ')}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={reset}>
                Choose a different file
              </Button>
              <Button type="button" onClick={runImport} disabled={report.validRows === 0 || busy}>
                Import {report.validRows} {noun}
                {report.validRows === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 4: Importing ---------- */}
        {step === 3 && (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-gray-700">
              Enrolling {report?.validRows} {noun}
              {report?.validRows === 1 ? '' : 's'}…
            </p>
            <p className="text-xs text-gray-500">
              Generating passwords and sending enrollment emails. Please keep this open.
            </p>
          </div>
        )}

        {/* ---------- Step 5: Result ---------- */}
        {step === 4 && result && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-lg font-semibold text-gray-900">Import complete</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                <p className="text-xs text-green-600">Imported</p>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{result.skipped}</p>
                <p className="text-xs text-amber-600">Skipped</p>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{result.failed}</p>
                <p className="text-xs text-red-600">Failed</p>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border bg-gray-50 p-3">
              <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
              <p className="text-xs leading-relaxed text-gray-700">
                <span className="font-medium">{result.emailsSent}</span> enrollment email(s) sent
                {result.emailsFailed > 0 && (
                  <>
                    ,{' '}
                    <span className="font-medium text-amber-700">{result.emailsFailed} could not be
                    delivered</span>. Those accounts exist and are usable — the {noun}s can be given
                    credentials via a password reset
                  </>
                )}
                .
              </p>
            </div>

            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.errors.map((e, i) => (
                      <tr key={`${e.rowNumber}-${i}`}>
                        <td className="px-3 py-2 text-gray-400">{e.rowNumber}</td>
                        <td className="px-3 py-2">{e.email || '—'}</td>
                        <td className="px-3 py-2 text-red-700">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {result.errors.length > 0 && (
                <Button type="button" variant="outline" onClick={downloadFailedRows}>
                  <FileText className="mr-2 h-4 w-4" />
                  Download failed rows
                </Button>
              )}
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
