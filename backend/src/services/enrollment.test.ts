import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../config/db', () => ({ default: prismaMock }));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async (v: string) => `hashed:${v}`), compare: vi.fn() },
}));

const { UserService } = await import('./user.service');
const { EnrollmentHistoryService } = await import('./enrollment-history.service');

const TECH_STACK = { id: '11111111-1111-1111-1111-111111111111', name: 'React' };

const STUDENT_INPUT = {
  name: 'Ravi Kumar',
  email: 'Ravi.Kumar@Example.com',
  role: 'STUDENT' as const,
  niatId: 'NIAT2024001',
  universityName: 'Anna University',
  techStackId: TECH_STACK.id,
  actorId: 'admin1',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([]); // no conflicts
  prismaMock.techStack.findUnique.mockResolvedValue(TECH_STACK);
  prismaMock.user.create.mockImplementation(async ({ data }: any) => ({
    id: 'new-user',
    ...data,
    techStack: TECH_STACK,
  }));
  prismaMock.enrollmentEvent.createMany.mockResolvedValue({ count: 0 });
  prismaMock.enrollmentEvent.create.mockResolvedValue({});
});

function createdData(): Record<string, any> {
  return prismaMock.user.create.mock.calls[0][0].data;
}

describe('enrollUser — success', () => {
  it('creates the user and returns a generated password', async () => {
    const result = await UserService.enrollUser(STUDENT_INPUT);

    expect(result.generated).toBe(true);
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(result.user.id).toBe('new-user');
  });

  it('hashes the password before writing it', async () => {
    const result = await UserService.enrollUser(STUDENT_INPUT);

    expect(createdData().password).toBe(`hashed:${result.temporaryPassword}`);
    expect(createdData().password).not.toBe(result.temporaryPassword);
  });

  it('normalises the email to lower case', async () => {
    await UserService.enrollUser(STUDENT_INPUT);
    expect(createdData().email).toBe('ravi.kumar@example.com');
  });

  it('starts the account in the forced-change, undelivered state', async () => {
    await UserService.enrollUser(STUDENT_INPUT);

    expect(createdData()).toMatchObject({
      mustChangePassword: true,
      passwordChangedAt: null,
      credentialStatus: 'PENDING',
    });
  });

  it('records ENROLLED and CREDENTIAL_GENERATED, attributed to the admin', async () => {
    await UserService.enrollUser(STUDENT_INPUT);

    const events = prismaMock.enrollmentEvent.createMany.mock.calls[0][0].data;
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'ENROLLED',
      'CREDENTIAL_GENERATED',
    ]);
    expect(events.every((e: { actorId: string }) => e.actorId === 'admin1')).toBe(true);
  });

  it('never selects the password column back out', async () => {
    await UserService.enrollUser(STUDENT_INPUT);
    const select = prismaMock.user.create.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('password');
  });

  it('honours an explicit password for backward compatibility', async () => {
    const result = await UserService.enrollUser({ ...STUDENT_INPUT, password: 'Legacy1Pass!' });

    expect(result.generated).toBe(false);
    expect(result.temporaryPassword).toBe('Legacy1Pass!');
  });
});

describe('enrollUser — validation', () => {
  it('reports an email conflict', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'x', email: 'ravi.kumar@example.com', niatId: null, employeeId: null },
    ]);

    await expect(UserService.enrollUser(STUDENT_INPUT)).rejects.toThrow(/email already exists/i);
  });

  it('reports a NIAT ID conflict', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'x', email: 'other@example.com', niatId: 'NIAT2024001', employeeId: null },
    ]);

    await expect(UserService.enrollUser(STUDENT_INPUT)).rejects.toThrow(/NIAT ID already exists/i);
  });

  it('reports every conflict at once rather than one at a time', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'x', email: 'ravi.kumar@example.com', niatId: 'NIAT2024001', employeeId: null },
    ]);

    await expect(UserService.enrollUser(STUDENT_INPUT)).rejects.toThrow(
      /email already exists.*NIAT ID already exists/i
    );
  });

  it('rejects an unknown tech stack', async () => {
    prismaMock.techStack.findUnique.mockResolvedValue(null);
    await expect(UserService.enrollUser(STUDENT_INPUT)).rejects.toThrow(/tech stack does not exist/i);
  });

  it('writes nothing when validation fails', async () => {
    prismaMock.techStack.findUnique.mockResolvedValue(null);
    await expect(UserService.enrollUser(STUDENT_INPUT)).rejects.toThrow();

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentEvent.createMany).not.toHaveBeenCalled();
  });
});

describe('buildWhere — dashboard and table filters', () => {
  it('maps status strings onto the boolean column', () => {
    expect(UserService.buildWhere({ status: 'active' })).toMatchObject({ status: true });
    expect(UserService.buildWhere({ status: 'inactive' })).toMatchObject({ status: false });
    expect(UserService.buildWhere({ status: 'anything-else' })).not.toHaveProperty('status');
  });

  it('passes the credential status through', () => {
    expect(UserService.buildWhere({ credentialStatus: 'FAILED' })).toMatchObject({
      credentialStatus: 'FAILED',
    });
  });

  it('searches across name, email and both identifiers', () => {
    const where = UserService.buildWhere({ search: 'ravi' }) as any;
    const fields = where.OR.map((clause: Record<string, unknown>) => Object.keys(clause)[0]);
    expect(fields).toEqual(['name', 'email', 'niatId', 'employeeId']);
  });

  it('ignores a whitespace-only search', () => {
    expect(UserService.buildWhere({ search: '   ' })).not.toHaveProperty('OR');
  });
});

describe('updateProfile — password lifecycle', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
    prismaMock.user.update.mockResolvedValue({ id: 'u1', name: 'Ravi' });
  });

  it('clears the forced-change flag when the user sets their own password', async () => {
    await UserService.updateProfile('u1', { password: 'Str0ng!Pass' });

    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(false);
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(data.password).toBe('hashed:Str0ng!Pass');
  });

  it('rejects a password that fails the policy', async () => {
    await expect(UserService.updateProfile('u1', { password: 'weak' })).rejects.toThrow();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('records PASSWORD_CHANGED for a password update', async () => {
    await UserService.updateProfile('u1', { password: 'Str0ng!Pass' });
    expect(prismaMock.enrollmentEvent.create.mock.calls[0][0].data.type).toBe('PASSWORD_CHANGED');
  });

  it('records PROFILE_UPDATED for a name-only update', async () => {
    await UserService.updateProfile('u1', { name: 'Ravi K' });
    expect(prismaMock.enrollmentEvent.create.mock.calls[0][0].data.type).toBe('PROFILE_UPDATED');
  });

  it('does not touch the password when only the name changes', async () => {
    await UserService.updateProfile('u1', { name: 'Ravi K' });
    expect(prismaMock.user.update.mock.calls[0][0].data).not.toHaveProperty('password');
  });
});

describe('updateUser — mass-assignment protection', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.update.mockResolvedValue({ id: 'u1' });
  });

  it('ignores a password smuggled into an admin update', async () => {
    await UserService.updateUser('u1', { name: 'Ravi', password: 'plaintext' } as never);

    expect(prismaMock.user.update.mock.calls[0][0].data).not.toHaveProperty('password');
  });

  it('ignores unknown fields entirely', async () => {
    await UserService.updateUser('u1', { name: 'Ravi', isSuperUser: true } as never);

    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('isSuperUser');
    expect(data).toMatchObject({ name: 'Ravi' });
  });
});

describe('EnrollmentHistoryService', () => {
  it('truncates an over-long detail so one bad error cannot bloat a row', async () => {
    await EnrollmentHistoryService.record({
      userId: 'u1',
      type: 'CREDENTIAL_FAILED',
      detail: 'x'.repeat(2000),
    });

    const detail = prismaMock.enrollmentEvent.create.mock.calls[0][0].data.detail as string;
    expect(detail.length).toBe(500);
  });

  it('never throws when the audit write fails', async () => {
    prismaMock.enrollmentEvent.create.mockRejectedValue(new Error('table gone'));

    await expect(
      EnrollmentHistoryService.record({ userId: 'u1', type: 'ENROLLED' })
    ).resolves.toBeUndefined();
  });

  it('never throws when a batch audit write fails', async () => {
    prismaMock.enrollmentEvent.createMany.mockRejectedValue(new Error('table gone'));

    await expect(
      EnrollmentHistoryService.recordMany([{ userId: 'u1', type: 'ENROLLED' }])
    ).resolves.toBeUndefined();
  });

  it('does nothing for an empty batch', async () => {
    await EnrollmentHistoryService.recordMany([]);
    expect(prismaMock.enrollmentEvent.createMany).not.toHaveBeenCalled();
  });

  it('returns the timeline newest-first with a label, tone and icon', async () => {
    prismaMock.enrollmentEvent.findMany.mockResolvedValue([
      {
        id: 'e1',
        type: 'CREDENTIAL_FAILED',
        detail: 'SMTP unreachable',
        createdAt: new Date('2026-07-31T09:00:00Z'),
        actor: { id: 'a1', name: 'Super Admin', email: 'a@x.com' },
      },
    ]);

    const events = await EnrollmentHistoryService.listForUser('u1');

    expect(prismaMock.enrollmentEvent.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    });
    expect(events[0]).toMatchObject({
      label: 'Credential delivery failed',
      tone: 'bad',
      icon: 'mail-x',
      actor: { id: 'a1', name: 'Super Admin' },
    });
  });

  it('reports a self-service event as having no actor', async () => {
    prismaMock.enrollmentEvent.findMany.mockResolvedValue([
      {
        id: 'e2',
        type: 'FIRST_LOGIN',
        detail: null,
        createdAt: new Date(),
        actor: null,
      },
    ]);

    const events = await EnrollmentHistoryService.listForUser('u1');
    expect(events[0].actor).toBeNull();
    expect(events[0].label).toBe('First login');
  });

  it('clamps an absurd limit rather than trusting it', async () => {
    await EnrollmentHistoryService.listForUser('u1', 100000);
    expect(prismaMock.enrollmentEvent.findMany.mock.calls[0][0].take).toBe(500);
  });
});
