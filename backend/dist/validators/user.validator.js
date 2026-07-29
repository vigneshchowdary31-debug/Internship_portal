"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfileSchema = exports.updateUserSchema = exports.createUserSchema = void 0;
const zod_1 = require("zod");
exports.createUserSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string({ message: 'Name is required' }).min(2, 'Name must be at least 2 characters'),
        email: zod_1.z.string({ message: 'Email is required' }).email('Invalid email address'),
        password: zod_1.z.string({ message: 'Password is required' }).min(6, 'Password must be at least 6 characters'),
        role: zod_1.z.enum(['ADMIN', 'INSTRUCTOR', 'STUDENT'], {
            message: 'Role is required',
        }),
    }),
});
exports.updateUserSchema = zod_1.z.object({
    params: zod_1.z.object({
        id: zod_1.z.string().uuid('Invalid user ID format'),
    }),
    body: zod_1.z.object({
        name: zod_1.z.string().min(2).optional(),
        status: zod_1.z.boolean().optional(),
        role: zod_1.z.enum(['ADMIN', 'INSTRUCTOR', 'STUDENT']).optional(),
    }),
});
exports.updateProfileSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(2, 'Name must be at least 2 characters').optional(),
        password: zod_1.z.string().min(6, 'Password must be at least 6 characters').optional(),
    }),
});
