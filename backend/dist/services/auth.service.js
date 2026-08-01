"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const db_1 = __importDefault(require("../config/db"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const AppError_1 = require("../utils/AppError");
const jwt_1 = require("../utils/jwt");
const password_service_1 = require("./password.service");
const enrollment_history_service_1 = require("./enrollment-history.service");
const BCRYPT_ROUNDS = 10;
class AuthService {
    static async login(email, passwordString) {
        const user = await db_1.default.user.findUnique({
            where: { email: email.trim().toLowerCase() },
        });
        if (!user || !user.status) {
            throw new AppError_1.AppError('Invalid email or password', 401);
        }
        const isMatch = await bcrypt_1.default.compare(passwordString, user.password);
        if (!isMatch) {
            throw new AppError_1.AppError('Invalid email or password', 401);
        }
        const token = (0, jwt_1.generateToken)({ id: user.id, role: user.role });
        // Stamp the very first successful login exactly once. Guarded on the
        // column rather than on the event table so this costs one UPDATE on login
        // number one and nothing at all on every login after it.
        if (!user.firstLoginAt) {
            await db_1.default.user
                .update({ where: { id: user.id }, data: { firstLoginAt: new Date() } })
                .catch((error) => console.error('[auth] Could not stamp firstLoginAt:', error?.message || error));
            await enrollment_history_service_1.EnrollmentHistoryService.record({ userId: user.id, type: 'FIRST_LOGIN' });
        }
        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                // Drives the client-side redirect to /change-password. The server
                // enforces the same rule independently (requirePasswordChanged), so a
                // client that ignores this flag still cannot reach anything.
                mustChangePassword: user.mustChangePassword,
            },
            token,
        };
    }
    /**
     * One-time / self-service password change.
     *
     * Requires the current password even when `mustChangePassword` is set: the
     * temporary credential arrived by email, and proving possession of it is what
     * stops anyone who merely holds a session from silently taking the account
     * over.
     */
    static async changePassword(userId, currentPassword, newPassword) {
        const user = await db_1.default.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new AppError_1.AppError('User not found', 404);
        }
        const isMatch = await bcrypt_1.default.compare(currentPassword, user.password);
        if (!isMatch) {
            throw new AppError_1.AppError('Your current password is incorrect', 400);
        }
        const isSame = await bcrypt_1.default.compare(newPassword, user.password);
        if (isSame) {
            throw new AppError_1.AppError('Your new password must be different from your current password', 400);
        }
        const { valid, errors } = password_service_1.PasswordGeneratorService.validate(newPassword);
        if (!valid) {
            throw new AppError_1.AppError(errors.join('. '), 400);
        }
        const hashedPassword = await bcrypt_1.default.hash(newPassword, BCRYPT_ROUNDS);
        const updated = await db_1.default.user.update({
            where: { id: userId },
            data: {
                password: hashedPassword,
                mustChangePassword: false,
                passwordChangedAt: new Date(),
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                mustChangePassword: true,
                passwordChangedAt: true,
            },
        });
        await enrollment_history_service_1.EnrollmentHistoryService.record({
            userId,
            type: 'PASSWORD_CHANGED',
            detail: 'Temporary password replaced by the user',
            actorId: null, // self-service
        });
        return updated;
    }
}
exports.AuthService = AuthService;
