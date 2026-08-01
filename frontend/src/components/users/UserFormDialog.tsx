import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Loader2 } from 'lucide-react';

export type EnrollmentRole = 'STUDENT' | 'INSTRUCTOR';

/**
 * One dialog serving both roles.
 *
 * The previous implementation was duplicated per role and carried a "Temporary
 * Password" field. That field is gone: the backend now generates a
 * cryptographically secure password and emails it directly to the enrollee, so
 * a plaintext credential never passes through an admin's browser at all.
 */

/**
 * One schema covering both roles, with the role-specific fields validated
 * conditionally.
 *
 * A discriminated union of two schemas reads more naturally but does not
 * survive react-hook-form's generics — the resolver would have to satisfy both
 * shapes at once. A single stable shape keeps the form strongly typed, and
 * `superRefine` enforces exactly the same rules.
 */
const buildSchema = (role: EnrollmentRole) =>
  z
    .object({
      name: z.string().trim().min(2, 'Full name must be at least 2 characters'),
      email: z.string().trim().email('Enter a valid email address'),
      niatId: z.string().trim().default(''),
      universityName: z.string().trim().default(''),
      employeeId: z.string().trim().default(''),
      techStackId: z.string().min(1, 'Select a tech stack'),
    })
    .superRefine((data, ctx) => {
      if (role === 'STUDENT') {
        if (data.niatId.length < 2) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['niatId'], message: 'NIAT ID is required' });
        }
        if (data.universityName.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['universityName'],
            message: 'University name is required',
          });
        }
      } else if (data.employeeId.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['employeeId'],
          message: 'Employee ID is required',
        });
      }
    });

export interface UserFormData {
  name: string;
  email: string;
  niatId: string;
  universityName: string;
  employeeId: string;
  techStackId: string;
}

export interface TechStackOption {
  id: string;
  name: string;
}

/** What actually goes to the API — only the fields relevant to the role. */
export interface EnrollmentPayload {
  name: string;
  email: string;
  techStackId: string;
  niatId?: string;
  universityName?: string;
  employeeId?: string;
}

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: EnrollmentPayload) => void;
  role: EnrollmentRole;
  initialData?: Record<string, unknown> | null;
  isEditing: boolean;
  isLoading: boolean;
  /** Optional pre-fetched options; the dialog falls back to its own query. */
  techStacks?: TechStackOption[];
}

export function UserFormDialog({
  open,
  onOpenChange,
  onSubmit,
  role,
  initialData,
  isEditing,
  isLoading,
  techStacks,
}: UserFormDialogProps) {
  const isStudent = role === 'STUDENT';
  const noun = isStudent ? 'Student' : 'Instructor';

  // Loaded dynamically so a newly created tech stack appears without a rebuild.
  // Skipped when the parent already supplies the list.
  const { data: fetchedStacks = [], isLoading: loadingStacks } = useQuery<TechStackOption[]>({
    queryKey: ['tech-stacks'],
    queryFn: async () => (await api.get('/techstacks')).data.data,
    enabled: open && !techStacks,
  });

  const stackOptions = techStacks ?? fetchedStacks;

  const schema = useMemo(() => buildSchema(role), [role]);

  const EMPTY: UserFormData = {
    name: '',
    email: '',
    niatId: '',
    universityName: '',
    employeeId: '',
    techStackId: '',
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(schema) as never,
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      initialData
        ? {
            name: (initialData.name as string) ?? '',
            email: (initialData.email as string) ?? '',
            niatId: (initialData.niatId as string) ?? '',
            universityName: (initialData.universityName as string) ?? '',
            employeeId: (initialData.employeeId as string) ?? '',
            techStackId: (initialData.techStackId as string) ?? '',
          }
        : EMPTY
    );
    // EMPTY is a stable literal; re-creating it per render is intentional and
    // does not need to participate in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData, reset]);

  const fieldError = (field: keyof UserFormData): string | undefined => errors[field]?.message;

  /**
   * Strips the fields that do not apply to this role before submitting, so a
   * student payload never carries an empty employeeId (and vice versa) — the
   * server treats empty identifiers as null, but not sending them at all keeps
   * the request honest.
   */
  const submit = (data: UserFormData) => {
    const base = { name: data.name, email: data.email, techStackId: data.techStackId };
    onSubmit(
      isStudent
        ? { ...base, niatId: data.niatId, universityName: data.universityName }
        : { ...base, employeeId: data.employeeId }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${noun}` : `Enroll ${noun}`}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update this ${noun.toLowerCase()}'s enrollment details.`
              : `Enroll a new ${noun.toLowerCase()} in the training programme.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="space-y-4 pt-2" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              placeholder="e.g. Ravi Kumar"
              aria-invalid={!!fieldError('name')}
              {...register('name')}
            />
            {fieldError('name') && <p className="text-xs text-red-500">{fieldError('name')}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="e.g. ravi.kumar@example.com"
              aria-invalid={!!fieldError('email')}
              {...register('email')}
            />
            {fieldError('email') && <p className="text-xs text-red-500">{fieldError('email')}</p>}
          </div>

          {isStudent ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="niatId">NIAT ID</Label>
                <Input
                  id="niatId"
                  placeholder="e.g. NIAT2024001"
                  aria-invalid={!!fieldError('niatId')}
                  {...register('niatId')}
                />
                {fieldError('niatId') && <p className="text-xs text-red-500">{fieldError('niatId')}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="universityName">University Name</Label>
                <Input
                  id="universityName"
                  placeholder="e.g. Anna University"
                  aria-invalid={!!fieldError('universityName')}
                  {...register('universityName')}
                />
                {fieldError('universityName') && (
                  <p className="text-xs text-red-500">{fieldError('universityName')}</p>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="employeeId">Employee ID</Label>
              <Input
                id="employeeId"
                placeholder="e.g. EMP1001"
                aria-invalid={!!fieldError('employeeId')}
                {...register('employeeId')}
              />
              {fieldError('employeeId') && (
                <p className="text-xs text-red-500">{fieldError('employeeId')}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="techStackId">Tech Stack</Label>
            <Controller
              control={control}
              name="techStackId"
              render={({ field }) => (
                <Select
                  onValueChange={field.onChange}
                  value={field.value || undefined}
                  disabled={loadingStacks}
                >
                  <SelectTrigger id="techStackId" aria-invalid={!!fieldError('techStackId')}>
                    <SelectValue placeholder={loadingStacks ? 'Loading…' : 'Select tech stack'} />
                  </SelectTrigger>
                  <SelectContent>
                    {stackOptions.map((stack) => (
                      <SelectItem key={stack.id} value={stack.id}>
                        {stack.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {fieldError('techStackId') && (
              <p className="text-xs text-red-500">{fieldError('techStackId')}</p>
            )}
            {!loadingStacks && stackOptions.length === 0 && (
              <p className="text-xs text-amber-600">
                No tech stacks exist yet. Create one under Tech Stacks first.
              </p>
            )}
          </div>

          {!isEditing && (
            <div className="flex items-start gap-2.5 rounded-md border border-indigo-100 bg-indigo-50 p-3">
              <KeyRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-indigo-900">
                A secure password is generated automatically and emailed to the{' '}
                {noun.toLowerCase()}. They will be required to change it on first login.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditing ? 'Saving…' : 'Enrolling…'}
                </>
              ) : isEditing ? (
                'Save Changes'
              ) : (
                `Enroll ${noun}`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
