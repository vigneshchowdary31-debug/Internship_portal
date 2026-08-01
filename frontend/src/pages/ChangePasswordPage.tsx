import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Navigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth, homePathFor } from '../contexts/AuthContext';
import { useToast, errorMessage } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, Check, X, Loader2, LogOut } from 'lucide-react';

/** Mirrors the server policy in PasswordGeneratorService.validate. */
const RULES = [
  { label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { label: 'One special character', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[0-9]/, 'Password must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'Your new password must be different from your current password',
    path: ['newPassword'],
  });

type FormData = z.infer<typeof schema>;

export const ChangePasswordPage = () => {
  const { user, isLoading, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') || '';

  const mutation = useMutation({
    mutationFn: (data: FormData) => api.post('/auth/change-password', data),
    onSuccess: () => {
      setFormError(null);
      updateUser({ mustChangePassword: false });
      toast.success('Password changed', 'You now have full access to the portal.');
      navigate(user ? homePathFor(user.role) : '/login', { replace: true });
    },
    onError: (err: unknown) => {
      const message = errorMessage(err, 'Could not change your password.');
      setFormError(message);
      toast.error('Password change failed', message);
    },
  });

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  // Reached voluntarily from the profile area rather than forced.
  const isForced = user.mustChangePassword === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <Card className="w-full max-w-md border-t-4 border-t-primary shadow-lg">
        <CardHeader className="space-y-3">
          {isForced && (
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Password change required</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  You are signed in with a temporary password. Choose a new one to continue.
                </p>
              </div>
            </div>
          )}
          <div>
            <CardTitle className="text-2xl font-bold">Change your password</CardTitle>
            <CardDescription className="mt-1">
              Signed in as <span className="font-medium text-gray-700">{user.email}</span>
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4" noValidate>
            {formError && (
              <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {formError}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="currentPassword">
                {isForced ? 'Temporary password (from your email)' : 'Current password'}
              </Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.currentPassword}
                {...register('currentPassword')}
              />
              {errors.currentPassword && (
                <p className="text-xs text-red-500">{errors.currentPassword.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.newPassword}
                {...register('newPassword')}
              />
              {errors.newPassword && <p className="text-xs text-red-500">{errors.newPassword.message}</p>}
            </div>

            {/* Live checklist beats a single error string: the user can see which
                rule they still fail while typing, instead of after submitting. */}
            <ul className="space-y-1.5 rounded-md border bg-gray-50 p-3">
              {RULES.map((rule) => {
                const passed = rule.test(newPassword);
                return (
                  <li
                    key={rule.label}
                    className={`flex items-center gap-2 text-xs ${
                      passed ? 'text-green-700' : 'text-gray-500'
                    }`}
                  >
                    {passed ? (
                      <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <X className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" aria-hidden="true" />
                    )}
                    <span>{rule.label}</span>
                    <span className="sr-only">{passed ? '(met)' : '(not met)'}</span>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.confirmPassword}
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating…
                </>
              ) : (
                'Change password and continue'
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
              className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs text-gray-500 transition-colors hover:text-gray-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out instead
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
