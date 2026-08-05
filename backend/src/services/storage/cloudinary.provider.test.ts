import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { CloudinaryProvider } from './cloudinary.provider';

/**
 * The signature is the security boundary of direct uploads: it is what stops a
 * client choosing its own folder or overwriting someone else's object.
 *
 * It is implemented by hand rather than via the SDK, so these tests pin the
 * ALGORITHM — params sorted alphabetically, joined as `k=v&k=v`, secret
 * appended, SHA-1 hex — by recomputing it independently, rather than asserting
 * a hard-coded digest. A hard-coded value would only prove the implementation
 * still matches itself.
 */
describe('CloudinaryProvider.sign', () => {
  const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

  it('is SHA-1 of the sorted param string with the secret appended', () => {
    const signature = CloudinaryProvider.sign(
      { timestamp: 1315060510, public_id: 'sample_image' },
      'abcd'
    );
    // Canonical form: alphabetical (public_id before timestamp), then secret.
    expect(signature).toBe(sha1('public_id=sample_image&timestamp=1315060510abcd'));
  });

  it('appends the secret without a separator', () => {
    // Guards the most likely implementation slip: joining the secret with '&'.
    const signature = CloudinaryProvider.sign({ a: '1' }, 'S3CRET');
    expect(signature).toBe(sha1('a=1S3CRET'));
    expect(signature).not.toBe(sha1('a=1&S3CRET'));
  });

  it('sorts parameters alphabetically regardless of insertion order', () => {
    const a = CloudinaryProvider.sign({ timestamp: 1, public_id: 'x' }, 's');
    const b = CloudinaryProvider.sign({ public_id: 'x', timestamp: 1 }, 's');
    expect(a).toBe(b);
  });

  it('produces a different signature for a different public_id', () => {
    const a = CloudinaryProvider.sign({ public_id: 'a', timestamp: 1 }, 's');
    const b = CloudinaryProvider.sign({ public_id: 'b', timestamp: 1 }, 's');
    expect(a).not.toBe(b);
  });

  it('produces a different signature for a different secret', () => {
    const a = CloudinaryProvider.sign({ public_id: 'a', timestamp: 1 }, 'secret-1');
    const b = CloudinaryProvider.sign({ public_id: 'a', timestamp: 1 }, 'secret-2');
    expect(a).not.toBe(b);
  });

  it('returns a 40-character hex SHA-1', () => {
    expect(CloudinaryProvider.sign({ public_id: 'a', timestamp: 1 }, 's')).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe('CloudinaryProvider.createSignedUpload', () => {
  const withEnv = async <T>(fn: () => Promise<T>): Promise<T> => {
    const saved = { ...process.env };
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    try {
      return await fn();
    } finally {
      process.env = saved;
    }
  };

  it('routes content and submissions to separate folders', async () => {
    await withEnv(async () => {
      const provider = new CloudinaryProvider();
      const content = await provider.createSignedUpload({
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        purpose: 'content',
      });
      const submission = await provider.createSignedUpload({
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        purpose: 'submission',
      });
      expect(content.providerKey).toMatch(/^lms\/content\//);
      expect(submission.providerKey).toMatch(/^lms\/submissions\//);
    });
  });

  it('never collides for two uploads of the same filename', async () => {
    await withEnv(async () => {
      const provider = new CloudinaryProvider();
      const req = {
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        purpose: 'content' as const,
      };
      const a = await provider.createSignedUpload(req);
      const b = await provider.createSignedUpload(req);
      expect(a.providerKey).not.toBe(b.providerKey);
    });
  });

  it('slugifies unsafe filenames into a URL-clean key', async () => {
    await withEnv(async () => {
      const provider = new CloudinaryProvider();
      const ticket = await provider.createSignedUpload({
        filename: 'React Hooks — "Cheat Sheet" (v2)!.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        purpose: 'content',
      });
      expect(ticket.providerKey).toMatch(/^lms\/content\/[a-z0-9-]+$/);
    });
  });

  it('signs the public_id, so the client cannot redirect the upload elsewhere', async () => {
    await withEnv(async () => {
      const provider = new CloudinaryProvider();
      const ticket = await provider.createSignedUpload({
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        purpose: 'content',
      });
      const expected = CloudinaryProvider.sign(
        { public_id: ticket.providerKey, timestamp: Number(ticket.fields.timestamp) },
        'test-secret'
      );
      expect(ticket.fields.signature).toBe(expected);
      expect(ticket.fields.public_id).toBe(ticket.providerKey);
    });
  });

  it('reports unconfigured when credentials are absent', () => {
    const saved = { ...process.env };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    try {
      expect(new CloudinaryProvider().isConfigured()).toBe(false);
    } finally {
      process.env = saved;
    }
  });
});

/**
 * Regression tests for two defects found by running real files through the live
 * Cloudinary API. Both produced a *successful-looking* outcome while deleting
 * nothing, which is why they need tests rather than just a fix:
 *
 *   1. `/auto/destroy` — `auto` is an upload-only convenience. The live API
 *      answers `400 Invalid resource type 'auto'. Must be one of: image,
 *      javascript, css, video, raw.`
 *   2. Deleting by the public_id we SIGNED rather than the one Cloudinary
 *      RETURNED. Cloudinary appends the extension for `raw` assets, so the
 *      signed key misses, and the API replies HTTP 200 `{"result":"not found"}`
 *      — a success status for a no-op.
 *
 * The observed classifications are pinned below too: PDF is `image`, not `raw`,
 * because Cloudinary rasterises PDFs. Any mapping derived from MIME type would
 * have got that wrong, which is why resource_type is stored, not inferred.
 */
describe('CloudinaryProvider.delete', () => {
  afterEach(() => vi.unstubAllGlobals());

  const configure = () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
    vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
    return new CloudinaryProvider();
  };

  /** Captures the request the provider makes, replying with `payload`. */
  const stubFetch = (payload: unknown, ok = true, status = 200) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('targets the resource type endpoint, never /auto/destroy', async () => {
    const provider = configure();
    const fetchMock = stubFetch({ result: 'ok' });

    await provider.delete('lms/content/notes-ab12.docx', 'raw');

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/destroy');
    // The exact shape the live API rejects with a 400.
    expect(url).not.toContain('/auto/');
  });

  it.each([
    ['image', 'lms/content/diagram-9f2c'],
    ['raw', 'lms/content/deck-77ab.pptx'],
    ['video', 'lms/content/lecture-31de'],
  ])('routes %s assets to their own destroy endpoint', async (resourceType, key) => {
    const provider = configure();
    const fetchMock = stubFetch({ result: 'ok' });

    await provider.delete(key, resourceType);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://api.cloudinary.com/v1_1/test-cloud/${resourceType}/destroy`
    );
  });

  it('deletes by the exact key given, preserving the extension raw assets carry', async () => {
    const provider = configure();
    const fetchMock = stubFetch({ result: 'ok' });

    // The public_id Cloudinary returned — extension included.
    const returnedKey = 'lms/submissions/report-5def.zip';
    await provider.delete(returnedKey, 'raw');

    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get('public_id')).toBe(returnedKey);
    // Silently trimming the extension is exactly what made deletes miss.
    expect(body.get('public_id')).not.toBe('lms/submissions/report-5def');
  });

  it('signs the destroy request with the same algorithm as uploads', async () => {
    const provider = configure();
    const fetchMock = stubFetch({ result: 'ok' });

    await provider.delete('lms/content/a-1.pdf', 'raw');

    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    const expected = CloudinaryProvider.sign(
      // `invalidate` is a signed parameter — omitting it from the signature
      // while sending it in the body is rejected by Cloudinary.
      { invalidate: 'true', public_id: 'lms/content/a-1.pdf', timestamp: Number(body.get('timestamp')) },
      'test-secret'
    );
    expect(body.get('signature')).toBe(expected);
  });

  it('requests CDN invalidation, so a deleted file stops being served from cache', async () => {
    const provider = configure();
    const fetchMock = stubFetch({ result: 'ok' });

    await provider.delete('lms/content/a-1.pdf', 'raw');

    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get('invalidate')).toBe('true');
  });

  it('throws on HTTP 200 "not found" instead of reporting a phantom success', async () => {
    const provider = configure();
    stubFetch({ result: 'not found' });

    // The live API's response when the key or resource type is wrong. Treating
    // this as success is what let deleted content linger in storage.
    await expect(provider.delete('lms/content/missing', 'raw')).rejects.toThrow(/not found/i);
    await expect(provider.delete('lms/content/missing', 'raw')).rejects.toThrow(/NOT removed/);
  });

  it('surfaces the provider message on an error response', async () => {
    const provider = configure();
    stubFetch({ error: { message: "Invalid resource type 'auto'" } }, false, 400);

    await expect(provider.delete('lms/content/x', 'auto')).rejects.toThrow(
      /400.*Invalid resource type 'auto'/
    );
  });

  it('stays inert when credentials are absent, rather than calling out', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    vi.stubEnv('CLOUDINARY_API_KEY', '');
    vi.stubEnv('CLOUDINARY_API_SECRET', '');
    const fetchMock = stubFetch({ result: 'ok' });

    await new CloudinaryProvider().delete('lms/content/x', 'image');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * `auto` is valid on the UPLOAD endpoint only. It is rejected by destroy
 * (HTTP 400) and returns 404 on delivery — verified against the live API. This
 * pins the delivery half, which was dead code when the destroy bug was found
 * and would have reproduced it the moment a caller appeared.
 */
describe('CloudinaryProvider.getSignedDownloadUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts the resource type in the delivery path, never "auto"', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
    const provider = new CloudinaryProvider();

    expect(await provider.getSignedDownloadUrl('lms/content/deck-77ab.pptx', 'raw')).toBe(
      'https://res.cloudinary.com/test-cloud/raw/upload/lms/content/deck-77ab.pptx'
    );
    expect(await provider.getSignedDownloadUrl('lms/content/pic-1', 'image')).not.toContain('/auto/');
  });
});
