import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Upload, Download, Loader2, X } from 'lucide-react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { UserTable, type User } from './UserTable';
import {
  UserFormDialog,
  type EnrollmentPayload,
  type EnrollmentRole,
  type TechStackOption,
} from './UserFormDialog';
import { CsvImportDialog } from './CsvImportDialog';
import { CredentialsDialog, type EnrolledCredentials } from './CredentialsDialog';
import { EnrollmentHistoryDialog } from './EnrollmentHistoryDialog';
import { UserViewDialog } from './UserViewDialog';
import { StatusChangeDialog } from './StatusChangeDialog';
import { MoveStudentDialog } from '@/components/lms/MoveStudentDialog';

/**
 * Shared admin page for the Students and Instructors screens.
 *
 * The two previously existed as ~95% identical files. Parameterising by role
 * means enrollment, import, export, search and filtering only have one
 * implementation to keep correct.
 */

interface UserManagementPageProps {
  role: EnrollmentRole;
  title: string;
  description: string;
}

/** Sentinel for "no filter" — Radix Select cannot hold an empty string value. */
const ALL = '__all__';

/**
 * Named views the credential dashboard links to, e.g.
 * `/admin/students?view=awaiting-first-login`.
 *
 * Keeping these as named views rather than raw query params means the dashboard
 * card and the table agree on one definition — the card cannot drift from what
 * the table actually shows.
 */
export type UserView =
  | 'awaiting-first-login'
  | 'awaiting-password-change'
  | 'credential-failed'
  | 'recently-enrolled'
  | 'inactive';

const VIEW_LABELS: Record<UserView, string> = {
  'awaiting-first-login': 'Awaiting first login',
  'awaiting-password-change': 'Awaiting password change',
  'credential-failed': 'Credential delivery failed',
  'recently-enrolled': 'Recently enrolled (last 7 days)',
  inactive: 'Inactive accounts',
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Applies a named view. Kept beside VIEW_LABELS so the two cannot diverge. */
function matchesView(user: User, view: UserView): boolean {
  switch (view) {
    case 'awaiting-first-login':
      return user.status && !user.firstLoginAt;
    case 'awaiting-password-change':
      return user.status && user.mustChangePassword === true;
    case 'credential-failed':
      return user.credentialStatus === 'FAILED';
    case 'recently-enrolled':
      return Date.now() - new Date(user.createdAt).getTime() <= SEVEN_DAYS_MS;
    case 'inactive':
      return !user.status;
    default:
      return true;
  }
}

export function UserManagementPage({ role, title, description }: UserManagementPageProps) {
  const isStudent = role === 'STUDENT';
  const slug = isStudent ? 'students' : 'instructors';
  const noun = isStudent ? 'Student' : 'Instructor';

  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [techStackFilter, setTechStackFilter] = useState(ALL);
  const [universityFilter, setUniversityFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get('view') as UserView | null) ?? null;
  const activeView = view && view in VIEW_LABELS ? view : null;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Credential-management dialog state
  const [credentials, setCredentials] = useState<EnrolledCredentials | null>(null);
  const [viewingUser, setViewingUser] = useState<User | null>(null);
  const [historyUser, setHistoryUser] = useState<User | null>(null);
  const [statusTarget, setStatusTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<{ user: User; sendEmail: boolean } | null>(null);
  const [moveTarget, setMoveTarget] = useState<User | null>(null);

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users', role],
    queryFn: async () => (await api.get(`/users?role=${role}`)).data.data,
  });

  const { data: techStacks = [] } = useQuery<TechStackOption[]>({
    queryKey: ['tech-stacks'],
    queryFn: async () => (await api.get('/techstacks')).data.data,
  });

  const enrollMutation = useMutation({
    mutationFn: (data: EnrollmentPayload) => api.post(`/users/enroll/${slug.slice(0, -1)}`, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users', role] });
      queryClient.invalidateQueries({ queryKey: ['credential-status'] });
      setIsFormOpen(false);

      const payload = res.data.data;
      setCredentials({
        name: payload.user.name,
        email: payload.user.email,
        temporaryPassword: payload.temporaryPassword,
        delivered: payload.credentialDelivered,
        failureReason: payload.credentialFailureReason,
        variant: 'enrolled',
      });

      if (payload.credentialDelivered) {
        toast.success(`${noun} enrolled`, res.data.message);
      } else {
        toast.error(
          `${noun} enrolled successfully.`,
          'However, the credential email could not be delivered. Copy the password before closing the dialog.'
        );
      }
    },
    onError: (err) => toast.error(`Could not enroll ${noun.toLowerCase()}`, errorMessage(err)),
  });

  /**
   * Both reset actions share one mutation — they differ only in the endpoint
   * and therefore in whether the portal emails the credential. The previous
   * "resend → 409 → reset" detour is gone: resend could never actually resend
   * anything, so it now does the honest thing directly.
   */
  const resetMutation = useMutation({
    mutationFn: ({ user, sendEmail }: { user: User; sendEmail: boolean }) =>
      api.post(
        sendEmail
          ? `/users/${user.id}/reset-and-send-credentials`
          : `/users/${user.id}/reset-password`
      ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users', role] });
      queryClient.invalidateQueries({ queryKey: ['credential-status'] });
      setResetTarget(null);

      const payload = res.data.data;
      setCredentials({
        name: payload.user.name,
        email: payload.user.email,
        temporaryPassword: payload.temporaryPassword,
        delivered: payload.credentialDelivered,
        failureReason: payload.credentialFailureReason,
        emailed: payload.emailed,
        variant: 'reset',
      });

      if (!payload.emailed) {
        toast.success('New password generated', 'Share the credentials manually before closing.');
      } else if (payload.credentialDelivered) {
        toast.success('New credentials sent', res.data.message);
      } else {
        toast.error(
          'New credentials generated.',
          'However, the email could not be delivered. Copy or download them before closing.'
        );
      }
    },
    onError: (err) => {
      setResetTarget(null);
      toast.error('Could not reset credentials', errorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EnrollmentPayload }) => api.patch(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', role] });
      setIsFormOpen(false);
      toast.success(`${noun} updated`);
    },
    onError: (err) => toast.error('Could not save changes', errorMessage(err)),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status, statusReason }: { id: string; status: boolean; statusReason?: string }) =>
      api.patch(`/users/${id}`, { status, ...(statusReason ? { statusReason } : {}) }),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users', role] });
      queryClient.invalidateQueries({ queryKey: ['credential-status'] });
      setStatusTarget(null);
      toast.success(variables.status ? `${noun} activated` : `${noun} deactivated`);
    },
    onError: (err) => {
      setStatusTarget(null);
      toast.error('Could not update status', errorMessage(err));
    },
  });

  /**
   * Export reflects the filters currently applied on screen, so what an admin
   * sees is what they get. Search is intentionally excluded — it is a transient
   * lookup, not a saved view.
   */
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (techStackFilter !== ALL) params.set('techStackId', techStackFilter);
      if (universityFilter !== ALL) params.set('universityName', universityFilter);
      if (statusFilter !== ALL) params.set('status', statusFilter);

      const res = await api.get(`/users/export/${slug}?${params.toString()}`, {
        responseType: 'text',
      });

      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Export ready', 'Your CSV download has started.');
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  /** Universities present in the data — there is no separate university table. */
  const universities = useMemo(() => {
    const names = new Set<string>();
    users.forEach((u) => {
      if (u.universityName) names.add(u.universityName);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [users]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (activeView && !matchesView(u, activeView)) return false;
      if (techStackFilter !== ALL && u.techStackId !== techStackFilter) return false;
      if (universityFilter !== ALL && u.universityName !== universityFilter) return false;
      if (statusFilter === 'active' && !u.status) return false;
      if (statusFilter === 'inactive' && u.status) return false;
      if (!term) return true;
      return [u.name, u.email, u.niatId, u.employeeId, u.universityName]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(term));
    });
  }, [users, search, techStackFilter, universityFilter, statusFilter, activeView]);

  const hasFilters =
    techStackFilter !== ALL ||
    universityFilter !== ALL ||
    statusFilter !== ALL ||
    search !== '' ||
    !!activeView;

  const clearFilters = () => {
    setSearch('');
    setTechStackFilter(ALL);
    setUniversityFilter(ALL);
    setStatusFilter(ALL);
    clearView();
  };

  const clearView = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next, { replace: true });
  };

  // A view arriving in the URL is a deliberate navigation from the dashboard,
  // so any stale status filter is cleared to avoid an empty intersection.
  useEffect(() => {
    if (activeView) setStatusFilter(ALL);
  }, [activeView]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setEditingUser(null);
              setIsFormOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Enroll {noun}
          </Button>
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-white p-3 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
          <Input
            placeholder={`Search by name, email or ${isStudent ? 'NIAT ID' : 'employee ID'}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={`Search ${title}`}
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={techStackFilter} onValueChange={setTechStackFilter}>
            <SelectTrigger className="h-9 w-[160px]" aria-label="Filter by tech stack">
              <SelectValue placeholder="Tech Stack" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tech stacks</SelectItem>
              {techStacks.map((stack) => (
                <SelectItem key={stack.id} value={stack.id}>
                  {stack.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isStudent && (
            <Select value={universityFilter} onValueChange={setUniversityFilter}>
              <SelectTrigger className="h-9 w-[180px]" aria-label="Filter by university">
                <SelectValue placeholder="University" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All universities</SelectItem>
                {universities.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[130px]" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
              <X className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {activeView && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
          <p className="text-sm text-indigo-900">
            Showing <span className="font-semibold">{VIEW_LABELS[activeView]}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={clearView} className="h-7 text-indigo-700">
            <X className="mr-1 h-3.5 w-3.5" />
            Clear view
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {title.toLowerCase()}…
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Showing {filtered.length} of {users.length} {noun.toLowerCase()}
            {users.length === 1 ? '' : 's'}
          </p>
          <UserTable
            users={filtered}
            role={role}
            onView={setViewingUser}
            onEdit={(user) => {
              setEditingUser(user);
              setIsFormOpen(true);
            }}
            onResetAndSend={(user) => setResetTarget({ user, sendEmail: true })}
            onResetPassword={(user) => setResetTarget({ user, sendEmail: false })}
            onViewHistory={setHistoryUser}
            onMoveBatch={isStudent ? setMoveTarget : undefined}
            onToggleStatus={setStatusTarget}
            emptyMessage={
              hasFilters
                ? `No ${noun.toLowerCase()}s match these filters.`
                : `No ${noun.toLowerCase()}s enrolled yet.`
            }
          />
        </>
      )}

      <UserFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        role={role}
        initialData={editingUser as unknown as Record<string, unknown> | null}
        isEditing={!!editingUser}
        isLoading={enrollMutation.isPending || updateMutation.isPending}
        techStacks={techStacks}
        onSubmit={(data) => {
          if (editingUser) updateMutation.mutate({ id: editingUser.id, data });
          else enrollMutation.mutate(data);
        }}
      />

      <CsvImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} role={role} />

      <MoveStudentDialog
        open={!!moveTarget}
        onOpenChange={(open) => !open && setMoveTarget(null)}
        student={moveTarget}
      />

      <CredentialsDialog
        open={!!credentials}
        onOpenChange={(open) => !open && setCredentials(null)}
        credentials={credentials}
        roleNoun={noun}
      />

      <UserViewDialog
        open={!!viewingUser}
        onOpenChange={(open) => !open && setViewingUser(null)}
        user={viewingUser}
        role={role}
      />

      <EnrollmentHistoryDialog
        open={!!historyUser}
        onOpenChange={(open) => !open && setHistoryUser(null)}
        userId={historyUser?.id ?? null}
        userName={historyUser?.name ?? ''}
      />

      <StatusChangeDialog
        open={!!statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        user={statusTarget}
        isLoading={toggleStatusMutation.isPending}
        onConfirm={(reason) =>
          statusTarget &&
          toggleStatusMutation.mutate({
            id: statusTarget.id,
            status: !statusTarget.status,
            statusReason: reason,
          })
        }
      />

      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resetTarget?.sendEmail
                ? `Reset & send new credentials to ${resetTarget?.user.name}?`
                : `Reset password for ${resetTarget?.user.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-gray-600">
                <p>
                  A new temporary password will be generated. Their current password stops working
                  immediately, and they will be asked to choose a new one at next login.
                </p>
                <p>
                  {resetTarget?.sendEmail
                    ? 'The new credentials will be emailed to them, and shown to you once so you can share them if the email fails.'
                    : 'No email will be sent. The credentials are shown to you once — share them manually.'}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetTarget && resetMutation.mutate(resetTarget)}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending
                ? 'Working…'
                : resetTarget?.sendEmail
                  ? 'Reset & Send'
                  : 'Reset Password'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
