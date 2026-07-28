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
class AuthService {
    static async login(email, passwordString) {
        const user = await db_1.default.user.findUnique({
            where: { email },
        });
        if (!user || !user.status) {
            throw new AppError_1.AppError('Invalid email or password', 401);
        }
        const isMatch = await bcrypt_1.default.compare(passwordString, user.password);
        if (!isMatch) {
            throw new AppError_1.AppError('Invalid email or password', 401);
        }
        const token = (0, jwt_1.generateToken)({ id: user.id, role: user.role });
        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
            token,
        };
    }
}
exports.AuthService = AuthService;
