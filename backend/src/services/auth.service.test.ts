import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../config/db', () => ({ default: prismaMock }));

const bcryptCompare = vi.fn();
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async (v: string) => `hashed:${v}`),
    compare: (...args: unknown[]) => bcryptCompare(...args),
  },
}));

const { AuthService } = await import('./auth.service');
const { isAllowedDuringPasswordChange } = await import('../middlewares/auth.middleware');

const ENROLLED_USER = {
  id: 'u1',
  name: 'Ravi Kumar',
  email: 'ravi@example.com',
  password: 'hashed:Temp1Pass!',
  role: 'STUDENT',
  status: true,
  mustChangePassword: true,
  passwordChangedAt: null,
  firstLoginAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'test-only-secret';
  prismaMock.user.findUnique.mockResolvedValue(ENROLLED_USER);
  prismaMock.user.update.mockResolvedValue(ENROLLED_USER);
  prismaMock.enrollmentEvent.create.mockResolvedValue({});
  bcryptCompare.mockResolvedValue(true);
});

describe('login', () => {
  it('returns mustChangePassword so the client can route to the welcome screen', async () => {
    const result = await AuthService.login('ravi@example.com', 'Temp1Pass!');

    expect(result.user.mustChangePassword).toBe(true);
    expect(result.token).toBeTypeOf('string');
  });

  it('never returns the password hash', async () => {
    const result = await AuthService.login('ravi@example.com', 'Temp1Pass!');
    expect(result.user).not.toHaveProperty('password');
  });

  it('normalises the email before lookup', async () => {
    await AuthService.login('  Ravi@Example.COM ', 'Temp1Pass!');
    expect(prismaMock.user.findUnique.mock.calls[0][0].where.email).toBe('ravi@example.com');
  });

  it('stamps firstLoginAt and records FIRST_LOGIN on the very first login', async () => {
    await AuthService.login('ravi@example.com', 'Temp1Pass!');

    expect(prismaMock.user.update.mock.calls[0][0].data.firstLoginAt).toBeInstanceOf(Date);
    expect(prismaMock.enrollmentEvent.create.mock.calls[0][0].data.type).toBe('FIRST_LOGIN');
  });

  it('does not re-stamp firstLoginAt on later logins', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...ENROLLED_USER,
      firstLoginAt: new Date('2026-07-01'),
    });

    await AuthService.login('ravi@example.com', 'Temp1Pass!');

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with a generic message', async () => {
    bcryptCompare.mockResolvedValue(false);
    await expect(AuthService.login('ravi@example.com', 'wrong')).rejects.toThrow(
      'Invalid email or password'
    );
  });

  it('gives the same generic message for an unknown account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(AuthService.login('nobody@example.com', 'x')).rejects.toThrow(
      'Invalid email or password'
    );
  });

  it('refuses a deactivated account', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...ENROLLED_USER, status: false });
    await expect(AuthService.login('ravi@example.com', 'Temp1Pass!')).rejects.toThrow(
      'Invalid email or password'
    );
  });
});

describe('changePassword', () => {
  it('completes the lifecycle: clears the flag and stamps the timestamp', async () => {
    // current matches, new is different
    bcryptCompare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await AuthService.changePassword('u1', 'Temp1Pass!', 'Str0ng!New1');

    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ mustChangePassword: false, password: 'hashed:Str0ng!New1' });
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('records PASSWORD_CHANGED with no actor, because it is self-service', async () => {
    bcryptCompare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await AuthService.changePassword('u1', 'Temp1Pass!', 'Str0ng!New1');

    expect(prismaMock.enrollmentEvent.create.mock.calls[0][0].data).toMatchObject({
      type: 'PASSWORD_CHANGED',
      actorId: null,
    });
  });

  it('requires the current password to be correct', async () => {
    bcryptCompare.mockResolvedValue(false);

    await expect(AuthService.changePassword('u1', 'wrong', 'Str0ng!New1')).rejects.toThrow(
      /current password is incorrect/i
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses to reuse the current password', async () => {
    bcryptCompare.mockResolvedValue(true); // matches current AND matches new

    await expect(AuthService.changePassword('u1', 'Temp1Pass!', 'Temp1Pass!')).rejects.toThrow(
      /must be different/i
    );
  });

  it('enforces the password policy', async () => {
    bcryptCompare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(AuthService.changePassword('u1', 'Temp1Pass!', 'weak')).rejects.toThrow();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(AuthService.changePassword('nope', 'a', 'Str0ng!New1')).rejects.toThrow(
      'User not found'
    );
  });
});

describe('password-change gate allowlist', () => {
  it.each([
    ['POST', '/api/auth/change-password'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/auth/me'],
    ['PATCH', '/api/users/profile'],
  ])('allows %s %s while gated', (method, path) => {
    expect(isAllowedDuringPasswordChange(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/api/users'],
    ['POST', '/api/users/enroll/student'],
    ['GET', '/api/sessions'],
    ['GET', '/api/users/credential-status'],
    ['POST', '/api/users/abc/reset-password'],
  ])('blocks %s %s while gated', (method, path) => {
    expect(isAllowedDuringPasswordChange(method, path)).toBe(false);
  });

  it('ignores the query string when matching', () => {
    expect(isAllowedDuringPasswordChange('GET', '/api/auth/me?x=1')).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(isAllowedDuringPasswordChange('GET', '/api/auth/me/')).toBe(true);
  });

  it('is case-insensitive on the method only, not the path', () => {
    expect(isAllowedDuringPasswordChange('get', '/api/auth/me')).toBe(true);
    expect(isAllowedDuringPasswordChange('GET', '/API/AUTH/ME')).toBe(false);
  });
});
