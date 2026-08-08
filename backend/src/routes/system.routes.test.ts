import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../config/db', () => ({ default: prismaMock }));

const queueSize = vi.fn();
vi.mock('../services/email/email-queue', () => ({
  emailQueue: {
    get size() {
      return queueSize();
    },
  },
}));

const systemRoutes = (await import('./system.routes')).default;

/**
 * The health endpoint is what an orchestrator acts on, so the status CODE
 * matters as much as the body: 200 keeps an instance in rotation, 503 takes it
 * out. Getting that backwards either hides an outage or cycles a healthy pod.
 */

/** Invokes the route handler directly — no supertest dependency needed. */
async function getHealth() {
  const layer = (systemRoutes as any).stack.find((l: any) => l.route?.path === '/health');
  const handler = layer.route.stack[0].handle;

  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as any;
  const next = vi.fn();

  handler({} as any, res, next);
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { status, json, body: json.mock.calls[0]?.[0], next };
}

beforeEach(() => {
  vi.clearAllMocks();
  queueSize.mockReturnValue(0);
  prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
});

describe('healthy', () => {
  it('answers 200 with the documented fields', async () => {
    queueSize.mockReturnValue(7);

    const { status, body } = await getHealth();

    expect(status).toHaveBeenCalledWith(200);
    expect(body.data).toMatchObject({
      status: 'healthy',
      queueSize: 7,
      isQueueFull: false,
      dbStatus: 'up',
    });
    expect(typeof body.data.uptime).toBe('number');
  });

  it('actually probes the database rather than assuming', async () => {
    await getHealth();

    // A health check that reports "up" without asking is worse than none: it
    // reports healthy for exactly as long as the outage lasts.
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});

describe('degraded', () => {
  it('answers 503 when the database is unreachable', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));

    const { status, body } = await getHealth();

    expect(status).toHaveBeenCalledWith(503);
    expect(body.success).toBe(false);
    expect(body.data.dbStatus).toBe('down');
    expect(body.data.status).toBe('degraded');
  });

  it('answers 503 rather than hanging when the database does not respond', async () => {
    // Never resolves. The endpoint has its own 2s deadline because a probe that
    // hangs gets the instance killed by the very check meant to reassure it.
    prismaMock.$queryRaw.mockReturnValue(new Promise(() => {}));

    const layer = (systemRoutes as any).stack.find((l: any) => l.route?.path === '/health');
    const handler = layer.route.stack[0].handle;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;

    handler({} as any, res, vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 2200));

    expect(json.mock.calls[0]![0].data.dbStatus).toBe('down');
  }, 5000);
});

describe('a full email queue is degraded mail, not a degraded app', () => {
  it('stays 200 with isQueueFull true', async () => {
    const { limits } = await import('../config/limits');
    queueSize.mockReturnValue(limits.email.queueMaxLength);

    const { status, body } = await getHealth();

    // Taking the instance out of rotation because mail is backed up would
    // remove capacity from a system whose only real problem is mail.
    expect(status).toHaveBeenCalledWith(200);
    expect(body.data.isQueueFull).toBe(true);
    expect(body.data.status).toBe('healthy');
  });

  it('reports the capacity alongside the depth', async () => {
    queueSize.mockReturnValue(12);

    const { body } = await getHealth();

    // "12 queued" means nothing without the ceiling it is approaching.
    expect(body.data.queueCapacity).toBeGreaterThan(0);
  });
});
