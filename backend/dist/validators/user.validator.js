"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.csvImportRoleSchema = exports.updateProfileSchema = exports.userIdParamSchema = exports.updateUserSchema = exports.enrollInstructorSchema = exports.enrollStudentSchema = exports.createUserSchema = void 0;
const zod_1 = require("zod");
const nameField = zod_1.z
    .string({ message: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(120, 'Name must be at most 120 characters');
const emailField = zod_1.z
    .string({ message: 'Email is required' })
    .trim()
    .email('Invalid email address')
    .max(200, 'Email must be at most 200 characters');
const identifierField = (label) => zod_1.z
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
exports.createUserSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: nameField,
        email: emailField,
        password: zod_1.z.string().min(6, 'Password must be at least 6 characters').optional(),
        role: zod_1.z.enum(['ADMIN', 'INSTRUCTOR', 'STUDENT'], { message: 'Role is required' }),
        niatId: identifierField('NIAT ID').optional(),
        universityName: zod_1.z.string().trim().min(2, 'University name must be at least 2 characters').max(200).optional(),
        employeeId: identifierField('Employee ID').optional(),
        techStackId: zod_1.z.string().uuid('Invalid tech stack').optional(),
    }),
});
/** Student enrollment — NIAT ID, university and tech stack are all mandatory. */
exports.enrollStudentSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: nameField,
        email: emailField,
        niatId: identifierField('NIAT ID'),
        universityName: zod_1.z
            .string({ message: 'University name is required' })
            .trim()
            .min(2, 'University name must be at least 2 characters')
            .max(200, 'University name must be at most 200 characters'),
        techStackId: zod_1.z.string({ message: 'Tech stack is required' }).uuid('Please select a tech stack'),
    }),
});
/** Instructor enrollment — employee ID and tech stack are mandatory. */
exports.enrollInstructorSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: nameField,
        email: emailField,
        employeeId: identifierField('Employee ID'),
        techStackId: zod_1.z.string({ message: 'Tech stack is required' }).uuid('Please select a tech stack'),
    }),
});
exports.updateUserSchema = zod_1.z.object({
    params: zod_1.z.object({
        id: zod_1.z.string().uuid('Invalid user ID format'),
    }),
    body: zod_1.z.object({
        name: nameField.optional(),
        email: emailField.optional(),
        status: zod_1.z.boolean().optional(),
        role: zod_1.z.enum(['ADMIN', 'INSTRUCTOR', 'STUDENT']).optional(),
        niatId: identifierField('NIAT ID').nullable().optional(),
        universityName: zod_1.z.string().trim().max(200).nullable().optional(),
        employeeId: identifierField('Employee ID').nullable().optional(),
        techStackId: zod_1.z.string().uuid('Invalid tech stack').nullable().optional(),
        /** Optional free-text reason recorded in the audit trail on activate/deactivate. */
        statusReason: zod_1.z.string().trim().max(300, 'Reason must be at most 300 characters').optional(),
    }),
});
/** Shared `:id` guard for the credential-management routes. */
exports.userIdParamSchema = zod_1.z.object({
    params: zod_1.z.object({
        id: zod_1.z.string().uuid('Invalid user ID format'),
    }),
});
exports.updateProfileSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
        password: zod_1.z.string().min(8, 'Password must be at least 8 characters').optional(),
    }),
});
exports.csvImportRoleSchema = zod_1.z.object({
    params: zod_1.z.object({
        role: zod_1.z.enum(['students', 'instructors'], { message: 'Role must be students or instructors' }),
    }),
});
