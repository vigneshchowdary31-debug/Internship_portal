"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.restrictTo = exports.authenticate = void 0;
exports.isAllowedDuringPasswordChange = isAllowedDuringPasswordChange;
const jwt_1 = require("../utils/jwt");
const AppError_1 = require("../utils/AppError");
const db_1 = __importDefault(require("../config/db"));
/**
 * Endpoints reachable while a user still owes a password change.
 *
 * Deliberately tiny: enough to load the shell, change the password, and leave.
 * Matched against the path with the query string stripped.
 */
const PASSWORD_CHANGE_ALLOWLIST = [
    { method: 'POST', path: '/api/auth/change-password' },
    { method: 'POST', path: '/api/auth/logout' },
    { method: 'GET', path: '/api/auth/me' },
    { method: 'PATCH', path: '/api/users/profile' },
];
function isAllowedDuringPasswordChange(method, originalUrl) {
    const path = originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
    return PASSWORD_CHANGE_ALLOWLIST.some((entry) => entry.method === method.toUpperCase() && entry.path === path);
}
/**
 * Verifies the bearer token and loads the current user.
 *
 * The user row is re-read on every request rather than trusted from the token,
 * so deactivation and a completed password change both take effect immediately
 * instead of at the next token expiry.
 *
 * The forced-password-change gate lives here, not in a separately-mounted
 * middleware, because `authenticate` is the one place `req.user` is populated —
 * enforcing it here means a newly added protected route is covered by default
 * rather than by remembering to chain another guard onto it.
 */
const authenticate = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
        return next(new AppError_1.AppError('You are not logged in! Please log in to get access.', 401));
    }
    let currentUser;
    try {
        const decoded = (0, jwt_1.verifyToken)(token);
        currentUser = (await db_1.default.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                mustChangePassword: true,
            },
        }));
    }
    catch (error) {
        return next(new AppError_1.AppError('Invalid token or token has expired', 401));
    }
    if (!currentUser) {
        return next(new AppError_1.AppError('The user belonging to this token does no longer exist.', 401));
    }
    if (!currentUser.status) {
        return next(new AppError_1.AppError('This account has been deactivated.', 403));
    }
    req.user = currentUser;
    if (currentUser.mustChangePassword && !isAllowedDuringPasswordChange(req.method, req.originalUrl)) {
        return next(new AppError_1.AppError('Password change required.', 403));
    }
    next();
};
exports.authenticate = authenticate;
const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return next(new AppError_1.AppError('You do not have permission to perform this action', 403));
        }
        next();
    };
};
exports.restrictTo = restrictTo;
