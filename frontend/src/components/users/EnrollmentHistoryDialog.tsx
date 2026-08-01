import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2,
  History,
  UserPlus,
  KeyRound,
  MailCheck,
  MailX,
  Ban,
  RotateCcw,
  ShieldCheck,
  LogIn,
  Power,
  PowerOff,
  Pencil,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EnrollmentEvent {
  id: string;
  type: string;
  label: string;
  tone: 'good' | 'bad' | 'neutral';
  /** Stable semantic key from the server, mapped to an icon below. */
  icon: string;
  detail: string | null;
  actor: { id: string; name: string } | null;
  createdAt: string;
}

/**
 * Maps the server's semantic icon key onto lucide components.
 *
 * The server sends a key rather than a component name so the two sides stay
 * decoupled — swapping icon libraries is a change to this map alone.
 */
const ICONS: Record<string, typeof Circle> = {
  'user-plus': UserPlus,
  key: KeyRound,
  'mail-check': MailCheck,
  'mail-x': MailX,
  ban: Ban,
  'rotate-ccw': RotateCcw,
  'shield-check': ShieldCheck,
  'log-in': LogIn,
  power: Power,
  'power-off': PowerOff,
  pencil: Pencil,
  circle: Circle,
};

const TONE_STYLES: Record<EnrollmentEvent['tone'], { ring: string; icon: string }> = {
  good: { ring: 'border-green-200 bg-green-50', icon: 'text-green-600' },
  bad: { ring: 'border-red-200 bg-red-50', icon: 'text-red-600' },
  neutral: { ring: 'border-gray-200 bg-gray-50', icon: 'text-gray-500' },
};

/**
 * Read-only audit timeline for one account, newest first.
 *
 * Labels and tone come from the server so every client renders the same
 * vocabulary — the frontend never has to keep its own copy of the event enum in
 * sync.
 */
export function EnrollmentHistoryDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName: string;
}) {
  const { data: events = [], isLoading } = useQuery<EnrollmentEvent[]>({
    queryKey: ['enrollment-history', userId],
    queryFn: async () => (await api.get(`/users/${userId}/enrollment-history`)).data.data,
    enabled: open && !!userId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-gray-500" aria-hidden="true" />
            <DialogTitle>Enrollment History</DialogTitle>
          </div>
          <DialogDescription>
            Every credential and access event for {userName}, newest first.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading history…
          </div>
        ) : events.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No history recorded for this account yet.
          </div>
        ) : (
          <ol className="relative space-y-0 pl-10">
            {/* Continuous rail behind the icons. */}
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-[15px] top-3 w-px bg-gray-200"
            />
            {events.map((event) => {
              const Icon = ICONS[event.icon] ?? Circle;
              const tone = TONE_STYLES[event.tone];
              return (
              <li key={event.id} className="relative pb-5 last:pb-0">
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full border',
                    tone.ring
                  )}
                >
                  <Icon className={cn('h-4 w-4', tone.icon)} />
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      event.tone === 'bad' ? 'text-red-700' : 'text-gray-900'
                    )}
                  >
                    {event.label}
                  </p>
                  <time
                    dateTime={event.createdAt}
                    className="whitespace-nowrap text-xs text-gray-400"
                  >
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </div>
                {event.detail && (
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{event.detail}</p>
                )}
                <p className="mt-0.5 text-xs text-gray-400">
                  {event.actor ? `by ${event.actor.name}` : 'by the user / system'}
                </p>
              </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
