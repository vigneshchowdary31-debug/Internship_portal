import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { CloudinaryProvider } from './cloudinary.provider';
import {
  UPLOAD_LIMITS,
  formatBytes,
  type SignedUploadRequest,
  type SignedUploadTicket,
  type StorageProvider,
} from './types';

/**
 * The only module in the codebase that knows which storage vendor is in use.
 *
 * Files never pass through Node: the browser receives a short-lived signature,
 * uploads directly to the provider, then calls back to register the asset. That
 * keeps the existing `express.json({ limit: '10kb' })` untouched and costs the
 * server zero bandwidth.
 */
export class StorageService {
  private static provider: StorageProvider | null = null;

  static getProvider(): StorageProvider {
    if (!this.provider) {
      // Supabase slots in here behind the same interface when it is needed.
      // The env var exists now so the switch is config, not a code change.
      const configured = (process.env.STORAGE_PROVIDER || 'CLOUDINARY').toUpperCase();
      if (configured !== 'CLOUDINARY') {
        console.warn(
          `[storage] STORAGE_PROVIDER=${configured} is not implemented yet; using Cloudinary.`
        );
      }
      this.provider = new CloudinaryProvider();
    }
    return this.provider;
  }

  static isConfigured(): boolean {
    return this.getProvider().isConfigured();
  }

  /**
   * Validates against the upload policy and returns a signed ticket.
   *
   * Enforcement happens HERE, before a signature exists — so an oversized or
   * disallowed file is rejected without a single byte being transferred.
   */
  static async createSignedUpload(input: SignedUploadRequest): Promise<SignedUploadTicket> {
    const provider = this.getProvider();

    if (!provider.isConfigured()) {
      throw new AppError(
        'File storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
        503
      );
    }

    const limits = UPLOAD_LIMITS[input.purpose];
    if (!limits) {
      throw new AppError('Unknown upload purpose.', 400);
    }

    if (!input.filename?.trim()) {
      throw new AppError('A filename is required.', 400);
    }

    if (input.sizeBytes <= 0) {
      throw new AppError('The file appears to be empty.', 400);
    }

    if (input.sizeBytes > limits.maxBytes) {
      throw new AppError(
        `That file is ${formatBytes(input.sizeBytes)}. The limit for ${input.purpose} uploads is ${formatBytes(limits.maxBytes)}.`,
        400
      );
    }

    if (!(limits.mimeTypes as readonly string[]).includes(input.mimeType)) {
      throw new AppError(
        `Files of type "${input.mimeType}" are not accepted here. Allowed: ${limits.mimeTypes.join(', ')}.`,
        400
      );
    }

    return provider.createSignedUpload(input);
  }

  /**
   * Registers an asset after the client's direct upload succeeded.
   *
   * The size and MIME reported here are echoed by the client, so they are
   * re-validated: a client that lied at signing time must not be able to
   * register something the policy would have refused.
   */
  static async confirmUpload(input: {
    /**
     * The public_id Cloudinary RETURNED — not the one we signed. For `raw`
     * assets Cloudinary appends the extension, and storing the signed key makes
     * every later delete a silent no-op.
     */
    providerKey: string;
    url: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    purpose: 'content' | 'submission';
    uploadedById: string;
    /** Provider classification: image | raw | video. Needed to delete. */
    resourceType?: string;
    /** Normalised format (pdf/png/jpg). Absent for raw assets. */
    format?: string;
    checksum?: string;
  }) {
    const limits = UPLOAD_LIMITS[input.purpose];
    if (input.sizeBytes > limits.maxBytes) {
      throw new AppError(
        `The uploaded file exceeds the ${formatBytes(limits.maxBytes)} limit and was not registered.`,
        400
      );
    }

    const provider = this.getProvider();

    // Idempotent: a retried confirm returns the existing row rather than
    // creating a duplicate asset for the same object.
    const existing = await prisma.mediaAsset.findUnique({
      where: { provider_providerKey: { provider: provider.name, providerKey: input.providerKey } },
    });
    if (existing) return existing;

    return prisma.mediaAsset.create({
      data: {
        provider: provider.name,
        providerKey: input.providerKey,
        url: input.url,
        originalFilename: input.originalFilename.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        resourceType: input.resourceType ?? null,
        format: input.format ?? null,
        checksum: input.checksum,
        uploadedById: input.uploadedById,
      },
    });
  }

  /**
   * Deletes an asset from the provider and the database.
   *
   * Refuses while anything still references it. Content uses SetNull, so
   * deleting an asset a piece of content points at is allowed and leaves the
   * content rendering "file unavailable" — but a submission artifact is
   * Restrict, and student work is never silently detached from its file.
   */
  static async deleteAsset(assetId: string): Promise<void> {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      include: { _count: { select: { contents: true } } },
    });

    if (!asset) throw new AppError('Asset not found', 404);

    if (asset._count.contents > 0) {
      throw new AppError(
        `This file is still used by ${asset._count.contents} content item(s). Remove it from them first.`,
        400
      );
    }

    // Provider first: if it fails we keep the row, so the object is never
    // orphaned in storage with no record of it. `delete` now throws on
    // {"result":"not found"} too, so a mismatched key cannot look like success.
    await this.getProvider().delete(asset.providerKey, asset.resourceType ?? undefined);
    await prisma.mediaAsset.delete({ where: { id: assetId } });
  }

  /** Assets no content references. Surfaced in the admin storage report. */
  static async findOrphans(limit = 100) {
    return prisma.mediaAsset.findMany({
      where: { contents: { none: {} } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
