"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePassword = exports.getMe = exports.logout = exports.login = void 0;
const auth_service_1 = require("../services/auth.service");
const asyncHandler_1 = require("../utils/asyncHandler");
exports.login = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    const result = await auth_service_1.AuthService.login(email, password);
    res.status(200).json({
        success: true,
        data: result,
    });
});
exports.logout = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // Since we are using stateless JWT, we just send a success message.
    // The client will remove the token from storage.
    res.status(200).json({
        success: true,
        message: 'Logged out successfully',
    });
});
/**
 * Returns the authenticated user.
 *
 * `name` and `email` are included because this is what the client rehydrates
 * its session from on a page refresh — omitting them leaves the UI rendering an
 * undefined display name. `mustChangePassword` drives the client-side redirect
 * to the change-password screen.
 */
exports.getMe = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id, name, email, role, status, mustChangePassword } = req.user;
    res.status(200).json({
        success: true,
        data: { user: { id, name, email, role, status, mustChangePassword } },
    });
});
exports.changePassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await auth_service_1.AuthService.changePassword(req.user.id, currentPassword, newPassword);
    res.status(200).json({
        success: true,
        data: { user },
        message: 'Password changed successfully',
    });
});
