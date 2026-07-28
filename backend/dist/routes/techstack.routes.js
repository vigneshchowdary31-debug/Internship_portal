"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const asyncHandler_1 = require("../utils/asyncHandler");
const db_1 = __importDefault(require("../config/db"));
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Get all tech stacks
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const techStacks = await db_1.default.techStack.findMany({ orderBy: { name: 'asc' } });
    res.status(200).json({ success: true, data: techStacks });
}));
// Create a tech stack (Admin only)
router.post('/', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name } = req.body;
    if (!name)
        return res.status(400).json({ success: false, message: 'Name is required' });
    const techStack = await db_1.default.techStack.create({ data: { name } });
    res.status(201).json({ success: true, data: techStack });
}));
// Edit a tech stack (Admin only)
router.patch('/:id', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name)
        return res.status(400).json({ success: false, message: 'Name is required' });
    const techStack = await db_1.default.techStack.update({
        where: { id },
        data: { name },
    });
    res.status(200).json({ success: true, data: techStack });
}));
// Delete a tech stack (Admin only)
router.delete('/:id', (0, auth_middleware_1.restrictTo)('ADMIN'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.default.techStack.delete({ where: { id } });
        res.status(200).json({ success: true, message: 'Tech stack deleted successfully' });
    }
    catch (error) {
        if (error.code === 'P2003') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete Tech Stack because it is used in active batches.'
            });
        }
        throw error;
    }
}));
exports.default = router;
