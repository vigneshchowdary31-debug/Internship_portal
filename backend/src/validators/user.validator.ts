import { z } from 'zod';

const nameField = z
  .string({ message: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(120, 'Name must be at most 120 characters');

const emailField = z
  .string({ message: 'Email is required' })
  .trim()
  .email('Invalid email address')
  .max(200, 'Email must be at most 200 characters');

const identifierField = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(60, `${label} must be at most 60 characters`);

/**
 * Generic user creation.
 *
 * `password` is optional: when omitted the backend generates a cryptographically
 * secure one and emails it. It is retained as an accepted field purely for
 * backward compatibility with any caller written before auto-generation — the
 * enrollment UI no longer sends it.
 */
export const createUserSchema = z.object({
  body: z.object({
    name: nameField,
    email: emailField,
    password: z.string().min(6, 'Password must be at least 6 characters').optional(),
    role: z.enum(['ADMIN', 'INSTRUCTOR', 'STUDENT'], { message: 'Role is required' }),
    niatId: identifierField('NIAT ID').optional(),
    universityName: z.string().trim().min(2, 'University name must be at least 2 characters').max(200).optional(),
    employeeId: identifierField('Employee ID').optional(),
    techStackId: z.string().uuid('Invalid tech stack').optional(),
  }),
});

/** Student enrollment — NIAT ID, university and tech stack are all mandatory. */
export const enrollStudentSchema = z.object({
  body: z.object({
    name: nameField,
    email: emailField,
    niatId: identifierField('NIAT ID'),
    universityName: z
      .string({ message: 'University name is required' })
      .trim()
      .min(2, 'University name must be at least 2 characters')
      .max(200, 'University name must be at most 200 characters'),
    techStackId: z.string({ message: 'Tech stack is required' }).uuid('Please select a tech stack'),
  }),
});

/** Instructor enrollment — employee ID and tech stack are mandatory. */
export const enrollInstructorSchema = z.object({
  body: z.object({
    name: nameField,
    email: emailField,
    employeeId: identifierField('Employee ID'),
    techStackId: z.string({ message: 'Tech stack is required' }).uuid('Please select a tech stack'),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID format'),
  }),
  body: z.object({
    name: nameField.optional(),
    email: emailField.optional(),
    status: z.boolean().optional(),
    role: z.enum(['ADMIN', 'INSTRUCTOR', 'STUDENT']).optional(),
    niatId: identifierField('NIAT ID').nullable().optional(),
    universityName: z.string().trim().max(200).nullable().optional(),
    employeeId: identifierField('Employee ID').nullable().optional(),
    techStackId: z.string().uuid('Invalid tech stack').nullable().optional(),
    /** Optional free-text reason recorded in the audit trail on activate/deactivate. */
    statusReason: z.string().trim().max(300, 'Reason must be at most 300 characters').optional(),
  }),
});

/** Shared `:id` guard for the credential-management routes. */
export const userIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID format'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  }),
});

export const csvImportRoleSchema = z.object({
  params: z.object({
    role: z.enum(['students', 'instructors'], { message: 'Role must be students or instructors' }),
  }),
});
