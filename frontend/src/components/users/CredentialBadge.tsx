import { CheckCircle2, AlertTriangle, Clock, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CredentialStatus = 'PENDING' | 'SENT' | 'FAILED' | 'RESET_SENT';

const VARIANTS: Record<
  CredentialStatus,
  { label: string; icon: typeof Clock; className: string }
> = {
  SENT: {
    label: 'Sent',
    icon: CheckCircle2,
    className: 'border-green-200 bg-green-50 text-green-700',
  },
  FAILED: {
    label: 'Failed',
    icon: AlertTriangle,
    className: 'border-red-200 bg-red-50 text-red-700',
  },
  PENDING: {
    label: 'Pending',
    icon: Clock,
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  // Visually distinct from SENT: both mean delivered, but only this one means
  // the user's previous password was invalidated.
  RESET_SENT: {
    label: 'Reset sent',
    icon: RotateCcw,
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
};

/**
 * Credential delivery state for one user.
 *
 * The icon is decorative — the label carries the meaning, so the badge is
 * readable without relying on colour alone.
 */
export function CredentialBadge({
  status,
  failureReason,
  retryCount,
  className,
}: {
  status?: CredentialStatus | null;
  failureReason?: string | null;
  retryCount?: number;
  className?: string;
}) {
  const variant = VARIANTS[status ?? 'PENDING'] ?? VARIANTS.PENDING;
  const Icon = variant.icon;

  const title =
    status === 'FAILED' && failureReason
      ? `${failureReason}${retryCount ? ` (${retryCount} attempt${retryCount === 1 ? '' : 's'})` : ''}`
      : undefined;

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        variant.className,
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {variant.label}
    </span>
  );
}
