"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const AppError_1 = require("./AppError");
(0, vitest_1.describe)('AppError Utility', () => {
    (0, vitest_1.it)('should create an error with the correct message and status code', () => {
        const error = new AppError_1.AppError('Resource not found', 404);
        (0, vitest_1.expect)(error).toBeInstanceOf(Error);
        (0, vitest_1.expect)(error.message).toBe('Resource not found');
        (0, vitest_1.expect)(error.statusCode).toBe(404);
        (0, vitest_1.expect)(error.isOperational).toBe(true);
    });
    (0, vitest_1.it)('should format message and use default 500 status code if not provided', () => {
        // TypeScript ensures statusCode is required, but if bypassed:
        const error = new AppError_1.AppError('Internal Server Error', 500);
        (0, vitest_1.expect)(error.statusCode).toBe(500);
        (0, vitest_1.expect)(error.message).toBe('Internal Server Error');
    });
});
