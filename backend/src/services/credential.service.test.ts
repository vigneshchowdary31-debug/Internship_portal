import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../config/db', () => ({ default: prismaMock }));

const sendEnrollmentEmail = vi.fn();
vi.mock('./enrollment-email.service', () => ({
  EnrollmentEmailService: { sendEnrollmentEmail: (...args: unknown[]) => sendEnrollmentEmail(...args) },
}));

// bcrypt.hash is real work (cost 10) and irrelevant to these assertions.
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async (v: string) => `hashed:${v}`), compare: vi.fn() },
}));

const { CredentialService } = await import('./credential.service');

const USER = { id: 'u1', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'STUDENT', status: true };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue(USER);
  prismaMock.user.update.mockResolvedValue(USER);
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.enrollmentEvent.create.mockResolvedValue({});
  prismaMock.enrollmentEvent.createMany.mockResolvedValue({ count: 0 });
  sendEnrollmentEmail.mockResolvedValue({ delivered: true });
});

/** Every audit event type written during a call, in order. */
function recordedEventTypes(): string[] {
  const single = prismaMock.enrollmentEvent.create.mock.calls.map((c) => c[0].data.type);
  const batched = prismaMock.enrollmentEvent.createMany.mock.calls.flatMap((c) =>
    c[0].data.map((d: { type: string }) => d.type)
  );
  return [...batched, ...single];
}

/** The data object of the last user.update call. */
function lastUserUpdate(): Record<string, unknown> {
  const calls = prismaMock.user.update.mock.calls;
  return calls[calls.length - 1][0].data;
}

/**
 * The data object of the FIRST user.update call.
 *
 * A reset-with-email produces two writes: the reset itself, then the delivery
 * outcome. Assertions about the reset state must look at the first, or they
 * would be reading the delivery update instead.
 */
function firstUserUpdate(): Record<string, unknown> {
  return prismaMock.user.update.mock.calls[0][0].data;
}

describe('recordDeliveryOutcome', () => {
  it('marks an original enrollment delivery as SENT', async () => {
    await CredentialService.recordDeliveryOutcome('u1', { delivered: true });

    expect(lastUserUpdate()).toMatchObject({
      credentialStatus: 'SENT',
      credentialFailureReason: null,
    });
    expect(recordedEventTypes()).toContain('CREDENTIAL_SENT');
  });

  it('marks a re-issued delivery as RESET_SENT, not SENT', async () => {
    await CredentialService.recordDeliveryOutcome('u1', { delivered: true }, { isRetry: true });

    expect(lastUserUpdate()).toMatchObject({ credentialStatus: 'RESET_SENT' });
  });

  it('increments the retry counter only on a retry', async () => {
    await CredentialService.recordDeliveryOutcome('u1', { delivered: true });
    expect(lastUserUpdate()).not.toHaveProperty('credentialRetryCount');

    await CredentialService.recordDeliveryOutcome('u1', { delivered: true }, { isRetry: true });
    expect(lastUserUpdate()).toMatchObject({ credentialRetryCount: { increment: 1 } });
  });

  it('records a failure with its reason and bumps the retry count', async () => {
    await CredentialService.recordDeliveryOutcome('u1', {
      delivered: false,
      reason: 'SMTP unreachable (CONNECTION_TIMEOUT)',
    });

    expect(lastUserUpdate()).toMatchObject({
      credentialStatus: 'FAILED',
      credentialFailureReason: 'SMTP unreachable (CONNECTION_TIMEOUT)',
      credentialRetryCount: { increment: 1 },
    });
    expect(recordedEventTypes()).toContain('CREDENTIAL_FAILED');
  });

  it('substitutes a reason when the transport did not supply one', async () => {
    await CredentialService.recordDeliveryOutcome('u1', { delivered: false });
    expect(lastUserUpdate().credentialFailureReason).toBeTruthy();
  });

  it('never throws when the database write fails', async () => {
    prismaMock.user.update.mockRejectedValue(new Error('connection lost'));
    await expect(
      CredentialService.recordDeliveryOutcome('u1', { delivered: true })
    ).resolves.toBeUndefined();
  });
});

describe('resetCredentials — shared behaviour', () => {
  it('returns the plaintext password exactly once', async () => {
    const result = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    expect(result.temporaryPassword).toBeTypeOf('string');
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
  });

  it('never persists the plaintext password', async () => {
    const result = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    const written = firstUserUpdate().password as string;
    expect(written).not.toBe(result.temporaryPassword);
    expect(written).toBe(`hashed:${result.temporaryPassword}`);
  });

  it('puts the user back into the forced-change state', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    // The reset write itself — before the delivery outcome overwrites the status.
    expect(firstUserUpdate()).toMatchObject({
      mustChangePassword: true,
      passwordChangedAt: null,
      credentialStatus: 'PENDING',
      credentialFailureReason: null,
      credentialSentAt: null,
    });
  });

  it('audits the reset and the generation', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    const types = recordedEventTypes();
    expect(types).toContain('PASSWORD_RESET');
    expect(types).toContain('CREDENTIAL_GENERATED');
  });

  it('attributes the audit events to the acting admin', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    const batched = prismaMock.enrollmentEvent.createMany.mock.calls[0][0].data;
    expect(batched.every((e: { actorId: string }) => e.actorId === 'admin1')).toBe(true);
  });

  it('rejects an unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      CredentialService.resetCredentials('nope', 'admin1', { sendEmail: true })
    ).rejects.toThrow('User not found');
  });

  it("refuses to reset another administrator's password", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...USER, id: 'admin2', role: 'ADMIN' });
    await expect(
      CredentialService.resetCredentials('admin2', 'admin1', { sendEmail: true })
    ).rejects.toThrow(/administrator/i);
  });

  it('allows an admin to reset their own password', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...USER, id: 'admin1', role: 'ADMIN' });
    await expect(
      CredentialService.resetCredentials('admin1', 'admin1', { sendEmail: true })
    ).resolves.toMatchObject({ emailed: true });
  });

  it('generates a different password every time', async () => {
    const a = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: false });
    const b = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: false });
    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  });
});

describe('resetCredentials — with email (Reset & Send New Credentials)', () => {
  it('sends the credential email', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    expect(sendEnrollmentEmail).toHaveBeenCalledTimes(1);
    const [role, recipient] = sendEnrollmentEmail.mock.calls[0];
    expect(role).toBe('STUDENT');
    expect(recipient.email).toBe('ravi@example.com');
  });

  it('transitions PENDING then RESET_SENT, in that order', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    const statuses = prismaMock.user.update.mock.calls.map((c) => c[0].data.credentialStatus);
    expect(statuses).toEqual(['PENDING', 'RESET_SENT']);
  });

  it('reports delivery success', async () => {
    const result = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });
    expect(result).toMatchObject({ emailed: true, delivered: true });
  });

  it('still succeeds when delivery fails, and surfaces the reason', async () => {
    sendEnrollmentEmail.mockResolvedValue({ delivered: false, reason: 'Mailbox full' });

    const result = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: true });

    expect(result.delivered).toBe(false);
    expect(result.failureReason).toBe('Mailbox full');
    // The password is still returned — this is exactly the case the one-time
    // disclosure exists for.
    expect(result.temporaryPassword).toBeTruthy();
  });
});

describe('resetCredentials — without email (Reset Password)', () => {
  it('sends no email at all', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: false });
    expect(sendEnrollmentEmail).not.toHaveBeenCalled();
  });

  it('reports emailed:false and leaves status PENDING', async () => {
    const result = await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: false });

    expect(result).toMatchObject({ emailed: false, delivered: false });
    expect(lastUserUpdate()).toMatchObject({ credentialStatus: 'PENDING' });
  });

  it('records that delivery is the admin\'s responsibility', async () => {
    await CredentialService.resetCredentials('u1', 'admin1', { sendEmail: false });

    const batched = prismaMock.enrollmentEvent.createMany.mock.calls[0][0].data;
    const reset = batched.find((e: { type: string }) => e.type === 'PASSWORD_RESET');
    expect(reset.detail).toMatch(/no email/i);
  });
});

describe('setStatus', () => {
  it('deactivates and audits with the supplied reason', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', status: true, role: 'STUDENT' });

    await CredentialService.setStatus('u1', false, 'admin1', 'Left the programme');

    expect(lastUserUpdate()).toMatchObject({ status: false });
    const event = prismaMock.enrollmentEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ type: 'DEACTIVATED', detail: 'Left the programme', actorId: 'admin1' });
  });

  it('activates and audits', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', status: false, role: 'STUDENT' });

    await CredentialService.setStatus('u1', true, 'admin1');

    expect(prismaMock.enrollmentEvent.create.mock.calls[0][0].data.type).toBe('ACTIVATED');
  });

  it('refuses self-deactivation', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin1', status: true, role: 'ADMIN' });
    await expect(CredentialService.setStatus('admin1', false, 'admin1')).rejects.toThrow(
      /your own account/i
    );
  });

  it('writes no event for a no-op change', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', status: true, role: 'STUDENT' });

    await CredentialService.setStatus('u1', true, 'admin1');

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(CredentialService.setStatus('nope', false, 'admin1')).rejects.toThrow('User not found');
  });
});

describe('getCredentialStats', () => {
  it('returns every metric the dashboard cards render', async () => {
    prismaMock.user.count.mockResolvedValue(7);

    const stats = await CredentialService.getCredentialStats();

    expect(stats).toMatchObject({
      awaitingFirstLogin: 7,
      awaitingPasswordChange: 7,
      failed: 7,
      recentlyEnrolledCount: 7,
      inactive: 7,
    });
    expect(Array.isArray(stats.recentlyEnrolled)).toBe(true);
    expect(Array.isArray(stats.failures)).toBe(true);
  });

  it('counts both SENT and RESET_SENT as delivered', async () => {
    await CredentialService.getCredentialStats();

    const sentCall = prismaMock.user.count.mock.calls.find(
      (c) => JSON.stringify(c[0]).includes('RESET_SENT')
    );
    expect(sentCall).toBeDefined();
  });
});
