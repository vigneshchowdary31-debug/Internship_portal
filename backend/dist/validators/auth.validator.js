"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePasswordSchema = exports.strongPasswordSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
exports.loginSchema = zod_1.z.object({
    body: zod_1.z.object({
        email: zod_1.z.string({ required_error: 'Email is required' }).email('Invalid email address'),
        password: zod_1.z.string({ required_error: 'Password is required' }).min(1, 'Password cannot be empty'),
    }),
});
/**
 * Password policy, mirrored from PasswordGeneratorService.validate so the
 * client gets field-level Zod errors. The service remains the authority and
 * re-checks server-side — this layer exists for message quality, not security.
 */
exports.strongPasswordSchema = zod_1.z
    .string({ required_error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must be at most 128 characters long')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');
exports.changePasswordSchema = zod_1.z.object({
    body: zod_1.z
        .object({
        currentPassword: zod_1.z
            .string({ required_error: 'Current password is required' })
            .min(1, 'Current password is required'),
        newPassword: exports.strongPasswordSchema,
        confirmPassword: zod_1.z
            .string({ required_error: 'Please confirm your new password' })
            .min(1, 'Please confirm your new password'),
    })
        .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'New password and confirmation do not match',
        path: ['confirmPassword'],
    })
        .refine((data) => data.newPassword !== data.currentPassword, {
        message: 'Your new password must be different from your current password',
        path: ['newPassword'],
    }),
});
