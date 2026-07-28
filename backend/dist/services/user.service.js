"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const db_1 = __importDefault(require("../config/db"));
const AppError_1 = require("../utils/AppError");
const bcrypt_1 = __importDefault(require("bcrypt"));
class UserService {
    static async createUser(data) {
        const existingUser = await db_1.default.user.findUnique({
            where: { email: data.email },
        });
        if (existingUser) {
            throw new AppError_1.AppError('User with this email already exists', 400);
        }
        const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
        const user = await db_1.default.user.create({
            data: {
                ...data,
                password: hashedPassword,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
            },
        });
        return user;
    }
    static async getUsers(role) {
        const users = await db_1.default.user.findMany({
            where: role ? { role: role } : undefined,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        return users;
    }
    static async getUserById(id) {
        const user = await db_1.default.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
                studentBatches: { include: { batch: true } },
                instructorBatches: { include: { batch: true } },
            },
        });
        if (!user) {
            throw new AppError_1.AppError('User not found', 404);
        }
        return user;
    }
    static async updateUser(id, data) {
        const userExists = await db_1.default.user.findUnique({ where: { id } });
        if (!userExists) {
            throw new AppError_1.AppError('User not found', 404);
        }
        const updatedUser = await db_1.default.user.update({
            where: { id },
            data,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
            },
        });
        return updatedUser;
    }
    static async updateProfile(id, data) {
        const userExists = await db_1.default.user.findUnique({ where: { id } });
        if (!userExists) {
            throw new AppError_1.AppError('User not found', 404);
        }
        const updateData = {};
        if (data.name)
            updateData.name = data.name;
        if (data.password) {
            updateData.password = await bcrypt_1.default.hash(data.password, 10);
        }
        const updatedUser = await db_1.default.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
            },
        });
        return updatedUser;
    }
}
exports.UserService = UserService;
