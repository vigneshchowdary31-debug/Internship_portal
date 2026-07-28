"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOverview = exports.getStudentAttendance = exports.getSessionAttendance = exports.updateAttendance = exports.markAttendance = void 0;
const attendance_service_1 = require("../services/attendance.service");
const asyncHandler_1 = require("../utils/asyncHandler");
exports.markAttendance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const data = {
        ...req.body,
        markedBy: req.user.id
    };
    const attendance = await attendance_service_1.AttendanceService.markAttendance(data);
    res.status(201).json({
        success: true,
        data: attendance,
    });
});
exports.updateAttendance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const data = {
        ...req.body,
        markedBy: req.user.id
    };
    const attendance = await attendance_service_1.AttendanceService.updateAttendance(req.params.id, data);
    res.status(200).json({
        success: true,
        data: attendance,
    });
});
exports.getSessionAttendance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const attendance = await attendance_service_1.AttendanceService.getSessionAttendance(req.params.sessionId);
    res.status(200).json({
        success: true,
        data: attendance,
    });
});
exports.getStudentAttendance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const attendance = await attendance_service_1.AttendanceService.getStudentAttendance(req.params.studentId);
    res.status(200).json({
        success: true,
        data: attendance,
    });
});
exports.getOverview = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const attendance = await attendance_service_1.AttendanceService.getOverview();
    res.status(200).json({
        success: true,
        data: attendance,
    });
});
