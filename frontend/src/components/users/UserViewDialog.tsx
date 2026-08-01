import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CredentialBadge } from './CredentialBadge';
import type { User } from './UserTable';
import type { EnrollmentRole } from './UserFormDialog';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2.5 last:border-b-0">
      <dt className="whitespace-nowrap text-xs font-medium text-gray-500">{label}</dt>
      <dd className="break-words text-right text-sm text-gray-900">{value}</dd>
    </div>
  );
}

const dash = <span className="text-xs text-gray-400">—</span>;

function formatDate(value?: string | null) {
  if (!value) return dash;
  return new Date(value).toLocaleString();
}

/** Read-only detail view, including the credential-delivery state. */
export function UserViewDialog({
  open,
  onOpenChange,
  user,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  role: EnrollmentRole;
}) {
  if (!user) return null;
  const isStudent = role === 'STUDENT';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <dl className="rounded-md border px-4 py-1">
          <Row
            label={isStudent ? 'NIAT ID' : 'Employee ID'}
            value={(isStudent ? user.niatId : user.employeeId) || dash}
          />
          {isStudent && <Row label="University" value={user.universityName || dash} />}
          <Row label="Tech Stack" value={user.techStack?.name || dash} />
          <Row
            label="Account Status"
            value={
              <Badge variant={user.status ? 'default' : 'secondary'}>
                {user.status ? 'Active' : 'Inactive'}
              </Badge>
            }
          />
          <Row
            label="Credential Status"
            value={
              <CredentialBadge
                status={user.credentialStatus}
                failureReason={user.credentialFailureReason}
                retryCount={user.credentialRetryCount}
              />
            }
          />
          {user.credentialStatus === 'FAILED' && user.credentialFailureReason && (
            <Row
              label="Failure Reason"
              value={<span className="text-xs text-red-700">{user.credentialFailureReason}</span>}
            />
          )}
          <Row label="Credential Sent" value={formatDate(user.credentialSentAt)} />
          {(user.credentialRetryCount ?? 0) > 0 && (
            <Row label="Delivery Attempts" value={user.credentialRetryCount} />
          )}
          <Row
            label="Password"
            value={
              user.mustChangePassword ? (
                <span className="text-xs font-medium text-amber-700">Awaiting first change</span>
              ) : (
                <span className="text-xs text-green-700">Set by user</span>
              )
            }
          />
          <Row label="Password Changed" value={formatDate(user.passwordChangedAt)} />
          <Row label="First Login" value={formatDate(user.firstLoginAt)} />
          <Row label="Enrolled" value={formatDate(user.createdAt)} />
        </dl>

        <div className="flex justify-end pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
