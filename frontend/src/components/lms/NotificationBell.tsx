import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { lmsApi, type AppNotification } from '@/services/lms';

/**
 * In-app notification bell.
 *
 * The unread count polls; the list is only fetched while the popover is open.
 * A badge that is wrong for a minute is a small cost, but fetching twenty
 * notification bodies every thirty seconds for a badge nobody opened is a real
 * one — so the cheap count query and the expensive list query are separate.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: countData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: lmsApi.unreadCount,
    refetchInterval: 60_000,
    // A failed poll should not surface an error toast on every screen.
    retry: false,
  });

  const { data: list, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => lmsApi.listNotifications({ pageSize: 15 }),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => lmsApi.markNotificationRead(id),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => lmsApi.markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  const unread = countData?.unread ?? 0;
  const items = list?.items ?? [];

  const handleOpen = (item: AppNotification) => {
    if (!item.readAt) markRead.mutate(item.id);
    setOpen(false);
    if (item.notification.linkUrl) navigate(item.notification.linkUrl);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
        }>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {/* Past 99 the exact number stops being useful and starts breaking the layout. */}
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-96">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">Loading…</p>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">You're all caught up.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleOpen(item)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-gray-50 ${
                      item.readAt ? '' : 'bg-blue-50/60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!item.readAt && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
                      )}
                      <div className={item.readAt ? 'pl-4' : ''}>
                        <p className="text-sm font-medium text-gray-900">
                          {item.notification.title}
                        </p>
                        {item.notification.body && (
                          <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">
                            {item.notification.body}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-400">
                          {formatRelative(item.notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/** "3h ago" beats a timestamp for a notification list. */
function formatRelative(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
