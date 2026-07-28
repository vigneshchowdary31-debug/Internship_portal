"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMe = exports.logout = exports.login = void 0;
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
exports.getMe = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.status(200).json({
        success: true,
        data: { user: req.user },
    });
});
