import { describe, it, expect } from 'vitest';
import { generateToken, verifyToken } from './jwt';

describe('JWT Utilities', () => {
  it('should generate and verify a token successfully', () => {
    const payload = { id: 'user-123', role: 'ADMIN' };
    
    const token = generateToken(payload);
    expect(token).toBeTypeOf('string');
    expect(token.length).toBeGreaterThan(10);
    
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(payload.id);
    expect(decoded.role).toBe(payload.role);
    expect(decoded).toHaveProperty('iat');
    expect(decoded).toHaveProperty('exp');
  });

  it('should throw an error for invalid token verification', () => {
    expect(() => verifyToken('invalid-token-string')).toThrow();
  });
});
