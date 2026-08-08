import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const providerDelete = vi.fn();
vi.mock('./cloudinary.provider', () => ({
  CloudinaryProvider: class {
    readonly name = 'CLOUDINARY' as const;
    isConfigured() {
      return true;
    }
    delete(...args: unknown[]) {
      return providerDelete(...args);
    }
  },
}));

const { StorageService } = await import('./storage.service');

/**
 * These cover the Phase 3 M2 changes to the storage layer: submissions now
 * reference MediaAsset, so both the delete guard and the orphan report have to
 * know about them. Getting either wrong is destructive rather than merely
 * wrong — the orphan report is a list an admin is invited to act on.
 */

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'asset1',
  providerKey: 'lms/submissions/report-5def.zip',
  resourceType: 'raw',
  _count: { contents: 0, submissions: 0 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.mediaAsset.findUnique.mockResolvedValue(asset());
  prismaMock.mediaAsset.delete.mockResolvedValue({});
  prismaMock.mediaAsset.findMany.mockResolvedValue([]);
  providerDelete.mockResolvedValue(undefined);
});

describe('deleteAsset — reference guards', () => {
  it('deletes an unreferenced asset', async () => {
    await expect(StorageService.deleteAsset('asset1')).resolves.toBeUndefined();
    expect(prismaMock.mediaAsset.delete).toHaveBeenCalled();
  });

  it('refuses while a submission still points at the file', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(
      asset({ _count: { contents: 0, submissions: 2 } })
    );

    // The Restrict foreign key would refuse this anyway, but as an opaque
    // constraint violation. This turns it into an explanation.
    await expect(StorageService.deleteAsset('asset1')).rejects.toThrow(
      /attached to 2 student submission/
    );
    expect(providerDelete).not.toHaveBeenCalled();
    expect(prismaMock.mediaAsset.delete).not.toHaveBeenCalled();
  });

  it('still refuses while content references it', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(
      asset({ _count: { contents: 1, submissions: 0 } })
    );

    await expect(StorageService.deleteAsset('asset1')).rejects.toThrow(/still used by 1 content/);
  });

  it('passes the STORED resourceType to the provider', async () => {
    await StorageService.deleteAsset('asset1');

    // Not inferred from the MIME type: Cloudinary classifies PDF as `image`,
    // and destroy rejects `auto` outright.
    expect(providerDelete).toHaveBeenCalledWith('lms/submissions/report-5def.zip', 'raw');
  });

  it('keeps the row when the provider call fails', async () => {
    providerDelete.mockRejectedValue(new Error('Cloudinary reported "not found"'));

    await expect(StorageService.deleteAsset('asset1')).rejects.toThrow(/not found/);
    // Otherwise the object is orphaned in storage with no record of it.
    expect(prismaMock.mediaAsset.delete).not.toHaveBeenCalled();
  });

  it('404s an unknown asset', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValue(null);
    await expect(StorageService.deleteAsset('nope')).rejects.toThrow('Asset not found');
  });
});

describe('findOrphans', () => {
  it('excludes assets attached to a submission', async () => {
    await StorageService.findOrphans();

    // Without this clause every student artifact would be listed as an orphan
    // the moment Phase 3 shipped — and an admin acting on that report would be
    // deleting handed-in work.
    expect(prismaMock.mediaAsset.findMany.mock.calls[0]![0].where).toEqual({
      contents: { none: {} },
      submissions: { none: {} },
    });
  });
});
