import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const announce = vi.fn();
vi.mock('./notification.service', () => ({
  NotificationService: { announceContentPublished: (...a: unknown[]) => announce(...a) },
}));

const { ContentService } = await import('./content.service');

const MODULE = { id: 'm1', learningPathId: 'lp1' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.module.findUnique.mockResolvedValue(MODULE);
  prismaMock.content.findFirst.mockResolvedValue(null);
  prismaMock.content.create.mockResolvedValue({ id: 'c1' });
  prismaMock.content.update.mockResolvedValue({ id: 'c1' });
  prismaMock.content.findMany.mockResolvedValue([]);
  prismaMock.content.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  announce.mockResolvedValue(null);
});

describe('REFERENCE accepts either a file or a link', () => {
  const base = { moduleId: 'm1', title: 'Further reading', type: 'REFERENCE', createdById: 'a1' };

  it('accepts an uploaded file', async () => {
    await expect(ContentService.create({ ...base, assetId: 'asset1' })).resolves.toBeTruthy();
  });

  it('accepts an external URL', async () => {
    await expect(
      ContentService.create({ ...base, externalUrl: 'https://example.com/paper' })
    ).resolves.toBeTruthy();
  });

  it('rejects an item carrying neither', async () => {
    // A reading list mixes uploaded papers and external articles, so REFERENCE
    // is the one type that permits either — but not nothing.
    await expect(ContentService.create(base)).rejects.toThrow(
      /needs either an uploaded file or a URL/
    );
  });
});

describe('payload rules for the other types are unchanged', () => {
  it('still requires a file for PDF', async () => {
    await expect(
      ContentService.create({ moduleId: 'm1', title: 'Notes', type: 'PDF', createdById: 'a1' })
    ).rejects.toThrow(/requires an uploaded file/);
  });

  it('still requires a URL for GITHUB_REPO', async () => {
    await expect(
      ContentService.create({ moduleId: 'm1', title: 'Repo', type: 'GITHUB_REPO', createdById: 'a1' })
    ).rejects.toThrow(/requires a URL/);
  });
});

describe('publishing announces exactly once', () => {
  it('announces on a DRAFT -> PUBLISHED transition', async () => {
    prismaMock.content.findUnique.mockResolvedValue({ id: 'c1', status: 'DRAFT' });

    await ContentService.setStatus('c1', 'PUBLISHED', 'admin1');

    expect(announce).toHaveBeenCalledWith('c1', 'admin1');
  });

  it('does NOT re-announce an already published item', async () => {
    prismaMock.content.findUnique.mockResolvedValue({ id: 'c1', status: 'PUBLISHED' });

    await ContentService.setStatus('c1', 'PUBLISHED', 'admin1');

    // Re-saving a published item must not alert the batch again — that is how
    // students learn to ignore notifications.
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces when an archived item is published again', async () => {
    prismaMock.content.findUnique.mockResolvedValue({ id: 'c1', status: 'ARCHIVED' });

    await ContentService.setStatus('c1', 'PUBLISHED', null);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it.each(['DRAFT', 'ARCHIVED'] as const)('does not announce when moving to %s', async (status) => {
    prismaMock.content.findUnique.mockResolvedValue({ id: 'c1', status: 'PUBLISHED' });

    await ContentService.setStatus('c1', status, null);
    expect(announce).not.toHaveBeenCalled();
  });

  it('still publishes when announcing throws', async () => {
    prismaMock.content.findUnique.mockResolvedValue({ id: 'c1', status: 'DRAFT' });
    announce.mockRejectedValue(new Error('SMTP down'));

    // The content is live at this point; surfacing an error would invite a
    // retry that double-notifies.
    await expect(ContentService.setStatus('c1', 'PUBLISHED', null)).resolves.toBeTruthy();
    expect(prismaMock.content.update).toHaveBeenCalled();
  });

  it('rejects an unknown content id before touching notifications', async () => {
    prismaMock.content.findUnique.mockResolvedValue(null);

    await expect(ContentService.setStatus('nope', 'PUBLISHED', null)).rejects.toThrow('Content not found');
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('paginated module listing', () => {
  it('orders by position so a page boundary never reshuffles the curriculum', async () => {
    await ContentService.listForModulePaged('m1', { batchId: 'b1', includeUnpublished: false });

    expect(prismaMock.content.findMany.mock.calls[0]![0].orderBy).toEqual({ position: 'asc' });
  });

  it('computes skip and take from the page', async () => {
    await ContentService.listForModulePaged(
      'm1',
      { batchId: null, includeUnpublished: true },
      { page: 2, pageSize: 10 }
    );

    const call = prismaMock.content.findMany.mock.calls[0]![0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it('caps pageSize', async () => {
    await ContentService.listForModulePaged(
      'm1',
      { batchId: null, includeUnpublished: true },
      { pageSize: 5000 }
    );
    expect(prismaMock.content.findMany.mock.calls[0]![0].take).toBe(100);
  });

  it('reports hasMore from the total', async () => {
    prismaMock.content.count.mockResolvedValue(30);

    const result = await ContentService.listForModulePaged(
      'm1',
      { batchId: null, includeUnpublished: true },
      { page: 1, pageSize: 25 }
    );

    expect(result.total).toBe(30);
    expect(result.hasMore).toBe(true);
  });
});
