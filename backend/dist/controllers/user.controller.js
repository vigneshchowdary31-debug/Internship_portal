"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = exports.updateUser = exports.getUserById = exports.getUsers = exports.createUser = void 0;
const user_service_1 = require("../services/user.service");
const asyncHandler_1 = require("../utils/asyncHandler");
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await user_service_1.UserService.createUser(req.body);
    res.status(201).json({
        success: true,
        data: user,
    });
});
exports.getUsers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { role } = req.query;
    const users = await user_service_1.UserService.getUsers(role);
    res.status(200).json({
        success: true,
        data: users,
    });
});
exports.getUserById = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await user_service_1.UserService.getUserById(req.params.id);
    res.status(200).json({
        success: true,
        data: user,
    });
});
exports.updateUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await user_service_1.UserService.updateUser(req.params.id, req.body);
    res.status(200).json({
        success: true,
        data: user,
    });
});
exports.updateProfile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // Use the authenticated user's ID
    const user = await user_service_1.UserService.updateProfile(req.user.id, req.body);
    res.status(200).json({
        success: true,
        data: user,
        message: 'Profile updated successfully',
    });
});
