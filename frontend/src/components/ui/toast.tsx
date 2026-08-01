import * as React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minimal toast system.
 *
 * Written directly against Radix-free primitives rather than pulling in
 * @radix-ui/react-toast: the surface needed here is one stack of dismissible
 * messages, and adding a dependency for that is not worth the install churn.
 *
 * Accessibility: the region is an aria-live polite log so screen readers
 * announce new toasts without stealing focus.
 */

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

const AUTO_DISMISS_MS = 6000;

const VARIANTS: Record<ToastVariant, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-green-200 bg-green-50', iconColor: 'text-green-600' },
  error: { icon: AlertCircle, ring: 'border-red-200 bg-red-50', iconColor: 'text-red-600' },
  info: { icon: Info, ring: 'border-blue-200 bg-blue-50', iconColor: 'text-blue-600' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);
  // Timers are tracked so unmounting cannot leave a setState scheduled against
  // a dead component.
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    ({ title, description, variant = 'info' }) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, title, description, variant }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      );
    },
    [dismiss]
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const success = React.useCallback(
    (title: string, description?: string) => toast({ title, description, variant: 'success' }),
    [toast]
  );
  const error = React.useCallback(
    (title: string, description?: string) => toast({ title, description, variant: 'error' }),
    [toast]
  );

  const value = React.useMemo(
    () => ({ toast, success, error, dismiss }),
    [toast, success, error, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4"
      >
        {toasts.map((t) => {
          const { icon: Icon, ring, iconColor } = VARIANTS[t.variant];
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg',
                'animate-in slide-in-from-bottom-2 fade-in-0',
                ring
              )}
            >
              <Icon className={cn('mt-0.5 h-5 w-5 flex-shrink-0', iconColor)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                {t.description && (
                  <p className="mt-1 text-sm text-gray-600 break-words">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="flex-shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

/** Pulls the human-readable message out of an axios error, with a sane fallback. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const response = (err as { response?: { data?: { message?: string; errors?: { message: string }[] } } })
    ?.response;
  if (response?.data?.errors?.length) {
    return response.data.errors.map((e) => e.message).join('. ');
  }
  return response?.data?.message || fallback;
}
