import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CredentialBadge } from './CredentialBadge';
import {
  LogIn,
  KeyRound,
  MailX,
  UserPlus,
  UserMinus,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import type { User } from './UserTable';
import type { UserView } from './UserManagementPage';

interface CredentialStats {
  awaitingFirstLogin: number;
  awaitingPasswordChange: number;
  failed: number;
  recentlyEnrolledCount: number;
  inactive: number;
  recentlyEnrolled: User[];
  failures: User[];
}

/**
 * Actionable credential metrics.
 *
 * Every card links to the students table filtered to exactly the population it
 * counts, so a number is never a dead end. The named `?view=` values are owned
 * by `UserManagementPage`, which means the card and the table can never disagree
 * about what, say, "awaiting first login" means.
 *
 * Students are the default destination because they are the overwhelming
 * majority of enrolled users; the instructors table accepts the same views.
 */
const CARDS: {
  view: UserView;
  title: string;
  icon: typeof LogIn;
  key: keyof CredentialStats;
  tone: 'good' | 'bad' | 'warn' | 'neutral';
  hint: string;
}[] = [
  {
    view: 'awaiting-first-login',
    title: 'Awaiting First Login',
    icon: LogIn,
    key: 'awaitingFirstLogin',
    tone: 'warn',
    hint: 'Enrolled but never signed in',
  },
  {
    view: 'awaiting-password-change',
    title: 'Awaiting Password Change',
    icon: KeyRound,
    key: 'awaitingPasswordChange',
    tone: 'neutral',
    hint: 'Still on a temporary password',
  },
  {
    view: 'credential-failed',
    title: 'Credential Delivery Failures',
    icon: MailX,
    key: 'failed',
    tone: 'bad',
    hint: 'Email never reached them',
  },
  {
    view: 'recently-enrolled',
    title: 'Recently Enrolled',
    icon: UserPlus,
    key: 'recentlyEnrolledCount',
    tone: 'good',
    hint: 'In the last 7 days',
  },
  {
    view: 'inactive',
    title: 'Inactive Accounts',
    icon: UserMinus,
    key: 'inactive',
    tone: 'neutral',
    hint: 'Deactivated, cannot log in',
  },
];

const TONE = {
  good: { icon: 'text-green-600', value: 'text-green-700' },
  bad: { icon: 'text-red-600', value: 'text-red-700' },
  warn: { icon: 'text-amber-600', value: 'text-amber-700' },
  neutral: { icon: 'text-blue-600', value: 'text-gray-900' },
};

export function CredentialDashboardCards() {
  const { data, isLoading } = useQuery<CredentialStats>({
    queryKey: ['credential-status'],
    queryFn: async () => (await api.get('/users/credential-status')).data.data,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {CARDS.map((card) => (
          <Card key={card.view}>
            <CardHeader className="pb-2">
              <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
            </CardHeader>
            <CardContent>
              <div className="h-7 w-12 animate-pulse rounded bg-gray-100" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const tone = TONE[card.tone];
          const value = data[card.key] as number;

          return (
            <Link
              key={card.view}
              to={`/admin/students?view=${card.view}`}
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-gray-50/60">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                  <Icon className={`h-4 w-4 ${tone.icon}`} aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${tone.value}`}>{value}</div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {card.hint}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {data.failures.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base text-red-700">
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
              Credential Delivery Failed
            </CardTitle>
            <CardDescription>
              These accounts exist but never received their credentials. Use{' '}
              <span className="font-medium">Reset &amp; Send New Credentials</span> to issue another.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.failures.map((user) => (
              <div
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-red-50/50 p-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{user.name}</p>
                  <p className="truncate text-xs text-gray-500">{user.email}</p>
                  {user.credentialFailureReason && (
                    <p className="mt-0.5 text-xs text-red-700">{user.credentialFailureReason}</p>
                  )}
                </div>
                <Link
                  to={`${
                    user.role === 'INSTRUCTOR' ? '/admin/instructors' : '/admin/students'
                  }?view=credential-failed`}
                  className="whitespace-nowrap text-xs font-medium text-primary hover:underline"
                >
                  Manage →
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center text-base">
            <UserPlus className="mr-2 h-4 w-4 text-primary" aria-hidden="true" />
            Recently Enrolled
          </CardTitle>
          <CardDescription>Students and instructors enrolled in the last 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentlyEnrolled.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              No one has been enrolled in the last 7 days.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs text-gray-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 font-medium">Credentials</th>
                    <th className="py-2 font-medium">Enrolled</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.recentlyEnrolled.map((user) => (
                    <tr key={user.id}>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-900">{user.name}</div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </td>
                      <td className="py-2 pr-3 text-xs capitalize text-gray-600">
                        {user.role.toLowerCase()}
                      </td>
                      <td className="py-2 pr-3">
                        <CredentialBadge
                          status={user.credentialStatus}
                          failureReason={user.credentialFailureReason}
                        />
                      </td>
                      <td className="whitespace-nowrap py-2 text-xs text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
