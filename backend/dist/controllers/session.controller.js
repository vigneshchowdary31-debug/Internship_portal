"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSession = exports.cancelSession = exports.updateSession = exports.getSessions = exports.createSession = void 0;
const session_service_1 = require("../services/session.service");
const asyncHandler_1 = require("../utils/asyncHandler");
const db_1 = __importDefault(require("../config/db"));
exports.createSession = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = await session_service_1.SessionService.createSession(req.body);
    res.status(201).json({
        success: true,
        data: session,
    });
});
exports.getSessions = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filters = {};
    if (req.user.role === 'INSTRUCTOR') {
        filters.instructorId = req.user.id;
    }
    else if (req.user.role === 'STUDENT') {
        const studentBatches = await db_1.default.studentBatch.findMany({ where: { studentId: req.user.id } });
        filters.batchId = { in: studentBatches.map(sb => sb.batchId) };
    }
    else {
        // Admin can filter by query params
        if (req.query.batchId)
            filters.batchId = req.query.batchId;
        if (req.query.instructorId)
            filters.instructorId = req.query.instructorId;
    }
    const sessions = await session_service_1.SessionService.getSessions(filters);
    res.status(200).json({
        success: true,
        data: sessions,
    });
});
exports.updateSession = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = await session_service_1.SessionService.updateSession(req.params.id, req.body);
    res.status(200).json({
        success: true,
        data: session,
    });
});
exports.cancelSession = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = await session_service_1.SessionService.cancelSession(req.params.id);
    res.status(200).json({
        success: true,
        data: session,
        message: 'Session cancelled successfully',
    });
});
exports.deleteSession = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await session_service_1.SessionService.deleteSession(req.params.id);
    res.status(200).json({
        success: true,
        message: 'Session deleted successfully',
    });
});
