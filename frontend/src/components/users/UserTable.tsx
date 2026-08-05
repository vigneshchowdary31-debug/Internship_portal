import {
  MoreHorizontal,
  Edit,
  Power,
  PowerOff,
  Eye,
  KeyRound,
  History,
  MailPlus,
  ArrowRightLeft,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CredentialBadge, type CredentialStatus } from './CredentialBadge';
import type { EnrollmentRole } from './UserFormDialog';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: boolean;
  createdAt: string;
  niatId?: string | null;
  universityName?: string | null;
  employeeId?: string | null;
  techStackId?: string | null;
  techStack?: { id: string; name: string } | null;
  /** Set while the user has not yet replaced their emailed temporary password. */
  mustChangePassword?: boolean;
  passwordChangedAt?: string | null;
  firstLoginAt?: string | null;
  credentialStatus?: CredentialStatus | null;
  credentialSentAt?: string | null;
  credentialFailureReason?: string | null;
  credentialRetryCount?: number;
  credentialLastRetryAt?: string | null;
}

interface UserTableProps {
  users: User[];
  role: EnrollmentRole;
  onView: (user: User) => void;
  onEdit: (user: User) => void;
  /** Reset & Send New Credentials — mints a password and emails it. */
  onResetAndSend: (user: User) => void;
  /** Reset Password — mints a password, sends no email. */
  onResetPassword: (user: User) => void;
  onToggleStatus: (user: User) => void;
  onViewHistory: (user: User) => void;
  /** Students only — moving between batches is not meaningful for instructors. */
  onMoveBatch?: (user: User) => void;
  emptyMessage?: string;
}

export function UserTable({
  users,
  role,
  onView,
  onEdit,
  onResetAndSend,
  onResetPassword,
  onToggleStatus,
  onViewHistory,
  onMoveBatch,
  emptyMessage = 'No users found.',
}: UserTableProps) {
  const isStudent = role === 'STUDENT';

  if (!users || users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-gray-50/50 p-8 text-center">
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>{isStudent ? 'NIAT ID' : 'Employee ID'}</TableHead>
            {isStudent && <TableHead>University</TableHead>}
            <TableHead>Tech Stack</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Credentials</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-[80px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">
                <div className="flex flex-col">
                  <span>{user.name}</span>
                  {/* Surfaces who has not yet logged in and rotated their
                      emailed password — the practical "did enrollment land?" signal. */}
                  {user.mustChangePassword && (
                    <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600">
                      Pending first login
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-gray-600">{user.email}</TableCell>
              <TableCell>
                {(isStudent ? user.niatId : user.employeeId) || (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </TableCell>
              {isStudent && (
                <TableCell className="text-gray-600">
                  {user.universityName || <span className="text-xs text-gray-400">—</span>}
                </TableCell>
              )}
              <TableCell>
                {user.techStack ? (
                  <Badge variant="outline">{user.techStack.name}</Badge>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={user.status ? 'default' : 'secondary'}>
                  {user.status ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell>
                <CredentialBadge
                  status={user.credentialStatus}
                  failureReason={user.credentialFailureReason}
                  retryCount={user.credentialRetryCount}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap text-gray-600">
                {new Date(user.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <span className="sr-only">Open actions for {user.name}</span>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onView(user)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(user)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit Details
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Both actions mint a NEW password — the original can never
                        be re-sent because plaintext is never stored. They differ
                        only in whether the portal emails it or the admin does. */}
                    <DropdownMenuItem onClick={() => onResetAndSend(user)}>
                      <MailPlus className="mr-2 h-4 w-4" />
                      Reset &amp; Send New Credentials
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onResetPassword(user)}>
                      <KeyRound className="mr-2 h-4 w-4" />
                      Reset Password (no email)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onViewHistory(user)}>
                      <History className="mr-2 h-4 w-4" />
                      Enrollment History
                    </DropdownMenuItem>

                    {isStudent && onMoveBatch && (
                      <DropdownMenuItem onClick={() => onMoveBatch(user)}>
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                        Move to Batch
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onClick={() => onToggleStatus(user)}
                      className={user.status ? 'text-red-600' : 'text-green-600'}
                    >
                      {user.status ? (
                        <>
                          <PowerOff className="mr-2 h-4 w-4" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <Power className="mr-2 h-4 w-4" />
                          Activate
                        </>
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
