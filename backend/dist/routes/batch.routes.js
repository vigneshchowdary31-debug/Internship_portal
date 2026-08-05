"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const asyncHandler_1 = require("../utils/asyncHandler");
const db_1 = __importDefault(require("../config/db"));
const auth_middleware_1 = require("../middlewares/auth.middleware");
const batch_membership_service_1 = require("../services/lms/batch-membership.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Get all batches with their tech stacks
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    let whereClause = {};
    // For students or instructors, we should filter, but for MVP we might just fetch what's needed.
    if (req.user.role === 'INSTRUCTOR') {
        whereClause = { instructorBatches: { some: { instructorId: req.user.id } } };
    }
    else if (req.user.role === 'STUDENT') {
        whereClause = { studentBatches: { some: { studentId: req.user.id } } };
    }
    const batches = await db_1.default.batch.findMany({
        where: whereClause,
        include: {
            techStack: true,
            instructorBatches: { include: { instructor: { select: { id: true, name: true } } } },
            studentBatches: { include: { student: { select: { id: true, name: true, email: true } } } },
        },
        orderBy: { name: 'asc' },
    });
    res.status(200).json({ success: true, data: batches });
}));
// Get a single batch by ID
router.get('/:id', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const batch = await db_1.default.batch.findUnique({
        where: { id },
        include: {
            techStack: true,
            instructorBatches: { include: { instructor: { select: { id: true, name: true, email: true } } } },
            studentBatches: { include: { student: { select: { id: true, name: true, email: true } } } },
        },
    });
    if (!batch) {
        return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    // Optional: check if instructor has access, but for MVP returning it is fine since auth middleware protects it
    res.status(200).json({ success: true, data: batch });
}));
// Create a batch (Admin only)
router.post('/', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name, techStackId } = req.body;
    if (!name || !techStackId) {
        return res.status(400).json({ success: false, message: 'Name and TechStackId are required' });
    }
    const batch = await db_1.default.batch.create({
        data: { name, techStackId },
    });
    res.status(201).json({ success: true, data: batch });
}));
/**
 * Replace a batch's student roster.
 *
 * Backward compatible in shape and status code, but the semantics changed with
 * the one-batch-per-student rule: a student arriving from another batch is now
 * MOVED rather than rejected by the unique constraint. Every add, move and
 * removal is written to the enrollment audit trail.
 */
router.post('/:id/students', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds)) {
        return res.status(400).json({ success: false, message: 'studentIds must be an array' });
    }
    const result = await batch_membership_service_1.BatchMembershipService.setBatchRoster(req.params.id, studentIds, req.user.id);
    const parts = [
        result.added > 0 ? `${result.added} added` : null,
        result.moved > 0 ? `${result.moved} moved from another batch` : null,
        result.removed > 0 ? `${result.removed} removed` : null,
    ].filter(Boolean);
    res.status(200).json({
        success: true,
        data: result,
        message: parts.length > 0 ? `Roster updated: ${parts.join(', ')}.` : 'No changes were needed.',
    });
}));
/** Explains what assigning this student would do, before it is done. */
router.post('/:id/students/preview', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { studentId } = req.body;
    if (!studentId) {
        return res.status(400).json({ success: false, message: 'studentId is required' });
    }
    const preview = await batch_membership_service_1.BatchMembershipService.previewAssignment(studentId, req.params.id);
    res.status(200).json({ success: true, data: preview });
}));
/** Assign or move a single student. */
router.post('/:id/students/assign', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { studentId } = req.body;
    if (!studentId) {
        return res.status(400).json({ success: false, message: 'studentId is required' });
    }
    const result = await batch_membership_service_1.BatchMembershipService.assign(studentId, req.params.id, req.user.id);
    res.status(200).json({
        success: true,
        data: result,
        message: result.moved
            ? `Student moved to "${result.preview.targetBatch.name}".`
            : `Student assigned to "${result.preview.targetBatch.name}".`,
    });
}));
// Assign Instructors to a Batch (Overwrite)
router.post('/:id/instructors', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { instructorIds } = req.body; // array of instructor ids
    const batchId = req.params.id;
    const data = instructorIds.map((instructorId) => ({ instructorId, batchId }));
    await db_1.default.$transaction([
        db_1.default.instructorBatch.deleteMany({ where: { batchId } }),
        db_1.default.instructorBatch.createMany({ data, skipDuplicates: true }),
    ]);
    res.status(200).json({ success: true, message: 'Instructors assigned successfully' });
}));
// Edit a batch (Admin only)
router.patch('/:id', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { name, techStackId } = req.body;
    if (!name || !techStackId)
        return res.status(400).json({ success: false, message: 'Name and TechStackId are required' });
    const batch = await db_1.default.batch.update({
        where: { id },
        data: { name, techStackId },
    });
    res.status(200).json({ success: true, data: batch });
}));
// Delete a batch (Admin only)
router.delete('/:id', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.default.batch.delete({ where: { id } });
        res.status(200).json({ success: true, message: 'Batch deleted successfully' });
    }
    catch (error) {
        if (error.code === 'P2003') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete Batch because it is used in active sessions.'
            });
        }
        throw error;
    }
}));
exports.default = router;
