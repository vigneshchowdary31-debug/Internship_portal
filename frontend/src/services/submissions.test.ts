import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('./api', () => ({ default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), delete: (...a: unknown[]) => del(...a) } }));

const { submissionsApi } = await import('./submissions');

/**
 * The request and the response use DIFFERENT names for the file fields:
 *
 *   request   providerKey / url
 *   response  publicId    / fileUrl
 *
 * Sending the response names produces a 400 that reads like a server fault, and
 * it is the single easiest mistake to make against this endpoint. These tests
 * pin the request shape so a rename cannot slip through silently.
 */

const UPLOAD = {
  // A raw .zip: Cloudinary appends the extension to the returned public_id.
  providerKey: 'lms/submissions/report-5def.zip',
  url: 'https://res.cloudinary.com/c/raw/upload/lms/submissions/report-5def.zip',
  resourceType: 'raw' as const,
  format: undefined,
  originalFilename: 'report.zip',
  mimeType: 'application/zip',
  sizeBytes: 2048,
};

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: { data: { id: 'sub1' } } });
  get.mockResolvedValue({ data: { data: [] } });
});

describe('submissionsApi.create — request field names', () => {
  it('sends providerKey and url, NOT publicId and fileUrl', async () => {
    await submissionsApi.create('a1', UPLOAD);

    const [, body] = post.mock.calls[0]!;
    expect(body.providerKey).toBe('lms/submissions/report-5def.zip');
    expect(body.url).toBe(UPLOAD.url);
    expect(body).not.toHaveProperty('publicId');
    expect(body).not.toHaveProperty('fileUrl');
  });

  it("forwards Cloudinary's RETURNED public_id, extension included", async () => {
    await submissionsApi.create('a1', UPLOAD);

    // Trimming the extension is what makes every later delete a silent no-op.
    expect(post.mock.calls[0]![1].providerKey).toBe('lms/submissions/report-5def.zip');
  });

  it('sends the three fields the validator requires beyond the file itself', async () => {
    await submissionsApi.create('a1', UPLOAD);

    // Omitting any of these 400s the whole request.
    const body = post.mock.calls[0]![1];
    expect(body.originalFilename).toBe('report.zip');
    expect(body.mimeType).toBe('application/zip');
    expect(body.sizeBytes).toBe(2048);
  });

  it('sends resourceType from the provider, never "auto"', async () => {
    await submissionsApi.create('a1', UPLOAD);
    expect(post.mock.calls[0]![1].resourceType).toBe('raw');
  });

  it('omits format entirely when the provider gave none', async () => {
    await submissionsApi.create('a1', UPLOAD);

    // `format: undefined` would serialise away anyway, but an explicit null
    // would fail the validator's string check. Omission is the safe shape.
    expect(post.mock.calls[0]![1]).not.toHaveProperty('format');
  });

  it('includes format when the provider gave one', async () => {
    await submissionsApi.create('a1', { ...UPLOAD, resourceType: 'image', format: 'pdf' });
    expect(post.mock.calls[0]![1].format).toBe('pdf');
  });

  it('posts to /submissions with the assignment id', async () => {
    await submissionsApi.create('a1', UPLOAD);

    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/submissions');
    expect(body.assignmentId).toBe('a1');
  });
});

describe('submissionsApi.listForAssignment', () => {
  it('filters by assignment and never by student', async () => {
    await submissionsApi.listForAssignment('a1');

    // Scoping to "my own" is the server's job; sending a studentId would be a
    // client asserting an authorization decision it does not own.
    const [url, config] = get.mock.calls[0]!;
    expect(url).toBe('/submissions');
    expect(config.params).toEqual({ assignmentId: 'a1', pageSize: 100 });
    expect(config.params).not.toHaveProperty('studentId');
  });

  it('unwraps the paginated envelope to the rows', async () => {
    get.mockResolvedValue({ data: { data: [{ id: 'sub1' }], meta: { total: 1 } } });
    await expect(submissionsApi.listForAssignment('a1')).resolves.toEqual([{ id: 'sub1' }]);
  });
});
