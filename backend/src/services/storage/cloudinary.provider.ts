import crypto from 'crypto';
import path from 'path';
import type {
  SignedUploadRequest,
  SignedUploadTicket,
  StorageProvider,
} from './types';

/**
 * Cloudinary adapter — the primary storage provider.
 *
 * Implemented against Cloudinary's documented signature algorithm rather than
 * their SDK. The algorithm is four lines (sort params, join, append secret,
 * SHA-1) and the only other call needed is a plain HTTPS DELETE. Adding a
 * dependency to a credential-adjacent path for that is not a good trade.
 *
 * Signature spec: sort the params to sign alphabetically, join as
 * `k=v&k=v`, append the API secret, SHA-1 the result, hex-encode.
 */
export class CloudinaryProvider implements StorageProvider {
  readonly name = 'CLOUDINARY' as const;

  private cloudName(): string {
    return process.env.CLOUDINARY_CLOUD_NAME || '';
  }
  private apiKey(): string {
    return process.env.CLOUDINARY_API_KEY || '';
  }
  private apiSecret(): string {
    return process.env.CLOUDINARY_API_SECRET || '';
  }

  isConfigured(): boolean {
    return Boolean(this.cloudName() && this.apiKey() && this.apiSecret());
  }

  /**
   * Builds Cloudinary's upload signature.
   *
   * Exported behaviour is pure and deterministic, so it is unit-tested against
   * the worked example in Cloudinary's own documentation.
   */
  static sign(params: Record<string, string | number>, apiSecret: string): string {
    const toSign = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
  }

  /**
   * Slugifies a filename into a safe public_id stem.
   *
   * Cloudinary derives the delivery URL from the public_id, so anything that
   * needs escaping in a URL is stripped rather than encoded — a clean id is
   * easier to debug than a percent-encoded one.
   */
  private static slug(filename: string): string {
    const base = path.basename(filename, path.extname(filename));
    const cleaned = base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return cleaned || 'file';
  }

  async createSignedUpload(input: SignedUploadRequest): Promise<SignedUploadTicket> {
    const folder = input.purpose === 'submission' ? 'lms/submissions' : 'lms/content';
    // Randomised suffix so two uploads of "notes.pdf" never collide.
    const providerKey = `${folder}/${CloudinaryProvider.slug(input.filename)}-${crypto
      .randomBytes(6)
      .toString('hex')}`;

    const timestamp = Math.floor(Date.now() / 1000);

    // Only these params are signed; Cloudinary rejects the upload if the client
    // alters any of them, which is what makes the folder and key non-forgeable.
    const signedParams = { public_id: providerKey, timestamp };
    const signature = CloudinaryProvider.sign(signedParams, this.apiSecret());

    // `auto` lets Cloudinary route PDFs/ZIPs to raw and media to image/video.
    const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudName()}/auto/upload`;

    return {
      provider: this.name,
      uploadUrl,
      fields: {
        api_key: this.apiKey(),
        timestamp: String(timestamp),
        public_id: providerKey,
        signature,
      },
      providerKey,
      // Cloudinary allows one hour of skew; a shorter window is stated so the
      // client refreshes rather than failing at the provider.
      expiresAt: new Date((timestamp + 600) * 1000).toISOString(),
    };
  }

  /**
   * Cloudinary assets are public-by-delivery-URL by default, so the stored URL
   * is already usable and no signing round-trip is needed. Kept on the
   * interface because Supabase private buckets do require it.
   *
   * `resourceType` is part of the delivery path, not decoration: `/auto/upload/`
   * returns `404 Resource not found - auto/upload/…` while `/image/upload/`
   * serves the file. `auto` is only ever valid on the UPLOAD endpoint.
   *
   * Prefer the `url` stored on MediaAsset — it is Cloudinary's own secure_url.
   * This exists for callers holding only a key.
   */
  async getSignedDownloadUrl(providerKey: string, resourceType: string = 'image'): Promise<string> {
    return `https://res.cloudinary.com/${this.cloudName()}/${resourceType}/upload/${providerKey}`;
  }

  /**
   * Deletes one asset.
   *
   * `resourceType` is REQUIRED and must be the value Cloudinary returned at
   * upload time. Two things were verified against the live API:
   *
   *   - `/auto/destroy` is rejected outright:
   *     `400 Invalid resource type 'auto'. Must be one of: image, javascript,
   *     css, video, raw.` — `auto` is an upload-only convenience.
   *   - `providerKey` must be the public_id Cloudinary RETURNED, not the one we
   *     signed. For `raw` assets Cloudinary appends the extension, and deleting
   *     by the un-suffixed key silently returns `{"result":"not found"}` with
   *     HTTP 200 — a success status for a delete that did nothing.
   *
   * That second case is why "not found" is treated as a failure below rather
   * than shrugged off: it is the exact signature of the bug this replaced.
   */
  async delete(providerKey: string, resourceType: string = 'image'): Promise<void> {
    if (!this.isConfigured()) return;

    const timestamp = Math.floor(Date.now() / 1000);
    // `invalidate` purges the CDN edge caches as well as the origin. Without it
    // a deleted file keeps being served from cache by direct URL — verified:
    // an asset the Admin API already reported as 404 still returned HTTP 200
    // from res.cloudinary.com. For content an instructor has deliberately
    // removed, that gap is the difference between deleted and merely unlisted.
    // It is a signed parameter, so it belongs in the signature too.
    const signedParams = { invalidate: 'true', public_id: providerKey, timestamp };
    const signature = CloudinaryProvider.sign(signedParams, this.apiSecret());

    const body = new URLSearchParams({
      invalidate: 'true',
      public_id: providerKey,
      timestamp: String(timestamp),
      api_key: this.apiKey(),
      signature,
    });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName()}/${resourceType}/destroy`,
      { method: 'POST', body }
    );

    const payload = (await response.json().catch(() => ({}))) as { result?: string; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(
        `Cloudinary delete failed (${response.status}) for ${providerKey}: ${payload.error?.message ?? 'unknown error'}`
      );
    }

    // HTTP 200 with result "not found" means we asked for the wrong key or the
    // wrong resource type. Reporting success here would silently leak storage.
    if (payload.result !== 'ok') {
      throw new Error(
        `Cloudinary reported "${payload.result}" deleting ${providerKey} ` +
          `(resource_type=${resourceType}). The asset was NOT removed.`
      );
    }
  }
}
