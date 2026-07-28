"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const jwt_1 = require("./jwt");
(0, vitest_1.describe)('JWT Utilities', () => {
    (0, vitest_1.it)('should generate and verify a token successfully', () => {
        const payload = { id: 'user-123', role: 'ADMIN' };
        const token = (0, jwt_1.generateToken)(payload);
        (0, vitest_1.expect)(token).toBeTypeOf('string');
        (0, vitest_1.expect)(token.length).toBeGreaterThan(10);
        const decoded = (0, jwt_1.verifyToken)(token);
        (0, vitest_1.expect)(decoded.id).toBe(payload.id);
        (0, vitest_1.expect)(decoded.role).toBe(payload.role);
        (0, vitest_1.expect)(decoded).toHaveProperty('iat');
        (0, vitest_1.expect)(decoded).toHaveProperty('exp');
    });
    (0, vitest_1.it)('should throw an error for invalid token verification', () => {
        (0, vitest_1.expect)(() => (0, jwt_1.verifyToken)('invalid-token-string')).toThrow();
    });
});
