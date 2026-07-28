"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.restrictTo = exports.authenticate = void 0;
const jwt_1 = require("../utils/jwt");
const AppError_1 = require("../utils/AppError");
const db_1 = __importDefault(require("../config/db"));
const authenticate = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
        return next(new AppError_1.AppError('You are not logged in! Please log in to get access.', 401));
    }
    try {
        const decoded = (0, jwt_1.verifyToken)(token);
        // Check if user still exists
        const currentUser = await db_1.default.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, role: true, status: true }
        });
        if (!currentUser) {
            return next(new AppError_1.AppError('The user belonging to this token does no longer exist.', 401));
        }
        if (!currentUser.status) {
            return next(new AppError_1.AppError('This account has been deactivated.', 403));
        }
        req.user = currentUser;
        next();
    }
    catch (error) {
        return next(new AppError_1.AppError('Invalid token or token has expired', 401));
    }
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
