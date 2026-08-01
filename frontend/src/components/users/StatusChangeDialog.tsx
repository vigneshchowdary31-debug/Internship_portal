import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, PowerOff, Power } from 'lucide-react';
import type { User } from './UserTable';

/**
 * Confirmation for activating or deactivating an account.
 *
 * The optional reason is written to the audit trail. It is genuinely optional —
 * requiring it would make admins type filler text, which is worse than an empty
 * field for anyone reading the history later.
 */
export function StatusChangeDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!user) return null;

  const deactivating = user.status;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            {deactivating ? (
              <PowerOff className="h-5 w-5 text-red-600" aria-hidden="true" />
            ) : (
              <Power className="h-5 w-5 text-green-600" aria-hidden="true" />
            )}
            <DialogTitle>
              {deactivating ? 'Deactivate' : 'Activate'} {user.name}?
            </DialogTitle>
          </div>
          <DialogDescription>
            {deactivating
              ? 'They will be signed out and blocked from logging in. Their enrollment, attendance and progress records are preserved.'
              : 'They will be able to log in again immediately with their existing password.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="status-reason">Reason (optional)</Label>
          <Textarea
            id="status-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder={
              deactivating ? 'e.g. Left the programme early' : 'e.g. Returned from a break'
            }
          />
          <p className="text-xs text-gray-500">
            Recorded in this account's enrollment history. {reason.length}/300
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={isLoading}
            className={deactivating ? 'bg-red-600 hover:bg-red-700' : ''}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : deactivating ? (
              'Deactivate'
            ) : (
              'Activate'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
