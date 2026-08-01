import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { downloadCredentialPdf } from '@/lib/credential-pdf';
import {
  CheckCircle2,
  Copy,
  Check,
  AlertTriangle,
  ShieldAlert,
  Download,
  UserCheck,
  MailCheck,
  MailX,
  MailMinus,
} from 'lucide-react';

/**
 * One-time credential disclosure.
 *
 * The plaintext password is available for exactly as long as this dialog is
 * mounted. It arrives in the enrollment or reset response, is never persisted
 * server-side, and cannot be retrieved by any other endpoint — closing this
 * dialog destroys the only copy that will ever exist.
 *
 * That is why the dialog cannot be dismissed by Escape or a click outside, and
 * why both Copy and Download exist: when email delivery fails, this screen is
 * the admin's only route to getting the user in.
 */

export interface EnrolledCredentials {
  name: string;
  email: string;
  temporaryPassword: string;
  /** False when the credential email failed, or was never attempted. */
  delivered: boolean;
  failureReason?: string | null;
  /** False for the "Reset Password" action, which deliberately sends no email. */
  emailed?: boolean;
  variant?: 'enrolled' | 'reset';
}

interface CredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: EnrolledCredentials | null;
  roleNoun: string;
}

/** Status of the account itself, and of the credential email, as separate facts. */
function StatusRow({
  icon: Icon,
  label,
  detail,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  detail?: string | null;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const styles = {
    good: { box: 'border-green-200 bg-green-50', icon: 'text-green-600', text: 'text-green-900' },
    bad: { box: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', text: 'text-amber-900' },
    neutral: { box: 'border-gray-200 bg-gray-50', icon: 'text-gray-500', text: 'text-gray-800' },
  }[tone];

  return (
    <div className={`flex items-start gap-2.5 rounded-md border p-3 ${styles.box}`}>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${styles.icon}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className={`text-sm font-medium ${styles.text}`}>{label}</p>
        {detail && <p className={`mt-0.5 text-xs leading-relaxed ${styles.text} opacity-80`}>{detail}</p>}
      </div>
    </div>
  );
}

export function CredentialsDialog({
  open,
  onOpenChange,
  credentials,
  roleNoun,
}: CredentialsDialogProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!credentials) return null;

  const isReset = credentials.variant === 'reset';
  const wasEmailed = credentials.emailed !== false;
  const portalUrl = window.location.origin;

  const heading = isReset
    ? 'Credentials Reset Successfully'
    : `${roleNoun} Enrolled Successfully`;

  const asText = [
    `Portal   : ${portalUrl}`,
    `Name     : ${credentials.name}`,
    `Email    : ${credentials.email}`,
    `Password : ${credentials.temporaryPassword}`,
    '',
    'This is a temporary password. You will be asked to change it at first login.',
  ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      toast.success('Credentials copied', 'Paste them somewhere safe before closing this dialog.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access is denied outside a secure context (plain http), which
      // is exactly when an admin most needs a fallback.
      toast.error(
        'Could not copy automatically',
        'Select the password text and copy it manually before closing.'
      );
    }
  };

  const download = () => {
    try {
      downloadCredentialPdf({
        name: credentials.name,
        email: credentials.email,
        temporaryPassword: credentials.temporaryPassword,
        portalUrl,
        roleNoun,
      });
      toast.success('Credentials downloaded', 'Delete the file once you have shared it securely.');
    } catch {
      toast.error('Could not generate the PDF', 'Use Copy Credentials instead.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Only opening is delegated. Closing must go through Done, because it
        // is irreversible.
        if (next) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
            <DialogTitle>{heading}</DialogTitle>
          </div>
          <DialogDescription>
            {isReset
              ? 'The previous password no longer works.'
              : 'The account is ready to use.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <StatusRow
            icon={UserCheck}
            tone="good"
            label={isReset ? 'New password set' : 'Account created'}
          />

          {/* Delivery is reported as its own fact — the account succeeding and
              the email succeeding are genuinely independent outcomes. */}
          {!wasEmailed ? (
            <StatusRow
              icon={MailMinus}
              tone="neutral"
              label="No email sent"
              detail="You chose to share these credentials manually."
            />
          ) : credentials.delivered ? (
            <StatusRow
              icon={MailCheck}
              tone="good"
              label="Credential delivery: Delivered"
              detail={`Sent to ${credentials.email}`}
            />
          ) : (
            <StatusRow
              icon={MailX}
              tone="bad"
              label="Credential delivery: Email delivery failed"
              detail={credentials.failureReason ?? undefined}
            />
          )}
        </div>

        {(!wasEmailed || !credentials.delivered) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <p className="text-xs font-medium leading-relaxed text-amber-900">
              Please manually share these credentials with the {roleNoun.toLowerCase()}.
            </p>
          </div>
        )}

        <dl className="space-y-3 rounded-md border bg-gray-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-xs font-medium text-gray-500">Email</dt>
            <dd className="break-all text-right text-sm font-medium text-gray-900">
              {credentials.email}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3 border-t pt-3">
            <dt className="whitespace-nowrap text-xs font-medium text-gray-500">
              Temporary Password
            </dt>
            <dd className="select-all break-all text-right font-mono text-sm font-semibold tracking-wide text-gray-900">
              {credentials.temporaryPassword}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3 border-t pt-3">
            <dt className="text-xs font-medium text-gray-500">Portal URL</dt>
            <dd className="break-all text-right text-sm text-gray-900">{portalUrl}</dd>
          </div>
        </dl>

        <div className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-red-900">
            <span className="font-semibold">This password is shown only once.</span> It is never
            stored in plaintext and cannot be retrieved again. If it is lost, use{' '}
            <span className="font-medium">Reset &amp; Send New Credentials</span> to issue another.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4 text-green-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Credentials
              </>
            )}
          </Button>
          <Button type="button" variant="outline" onClick={download}>
            <Download className="mr-2 h-4 w-4" />
            Download Credentials
          </Button>
          <Button
            type="button"
            onClick={() => {
              setCopied(false);
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
