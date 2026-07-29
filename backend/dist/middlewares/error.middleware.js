"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const zod_1 = require("zod");
const AppError_1 = require("../utils/AppError");
const errorHandler = (err, req, res, next) => {
    if (process.env.NODE_ENV !== 'test') {
        console.error(`\n--- ERROR [${req.method}] ${req.originalUrl} ---`);
        console.error(err);
        console.error('-------------------------------------------\n');
    }
    // Zod Validation Errors
    if (err instanceof zod_1.ZodError) {
        const errors = err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
        }));
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors,
        });
    }
    // Known Application Errors
    if (err instanceof AppError_1.AppError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
    }
    // Handle Prisma validation errors
    if (err.name === 'PrismaClientValidationError') {
        return res.status(400).json({
            success: false,
            message: 'Database validation failed',
            details: process.env.NODE_ENV === 'production' ? 'Invalid query payload' : err.message,
        });
    }
    if (err.name === 'PrismaClientKnownRequestError') {
        return res.status(400).json({
            success: false,
            message: 'Database query failed',
            details: process.env.NODE_ENV === 'production' ? 'Query constraint violation' : err.message,
        });
    }
    // Unhandled / Unknown Errors
    const message = process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : (err.message || 'Internal Server Error');
    return res.status(500).json({
        success: false,
        message,
    });
};
exports.errorHandler = errorHandler;
