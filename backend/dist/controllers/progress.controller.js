"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOverview = exports.getStudentProgress = exports.updateProgress = void 0;
const progress_service_1 = require("../services/progress.service");
const asyncHandler_1 = require("../utils/asyncHandler");
exports.updateProgress = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const progress = await progress_service_1.ProgressService.updateProgress(req.body);
    res.status(200).json({
        success: true,
        data: progress,
    });
});
exports.getStudentProgress = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const progress = await progress_service_1.ProgressService.getStudentProgress(req.params.studentId);
    res.status(200).json({
        success: true,
        data: progress,
    });
});
exports.getOverview = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const progress = await progress_service_1.ProgressService.getOverview();
    res.status(200).json({
        success: true,
        data: progress,
    });
});
