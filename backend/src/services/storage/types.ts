/**
 * Provider-agnostic storage contract.
 *
 * Only the adapters below this interface know which vendor is in use.
 * Controllers, services and the entire frontend deal in MediaAsset ids, so
 * swapping Cloudinary for Supabase Storage is an adapter change and a config
 * change — never a schema or API change.
 */

export type StorageProviderName = 'CLOUDINARY' | 'SUPABASE';

export interface SignedUploadRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Logical destination, mapped to a provider folder. */
  purpose: 'content' | 'submission';
}

/**
 * Everything the browser needs to POST the file directly to the provider.
 * Deliberately opaque to our own code — we never inspect or proxy the upload.
 */
export interface SignedUploadTicket {
  provider: StorageProviderName;
  /** Where the browser POSTs. */
  uploadUrl: string;
  /** Form fields to include alongside the file. */
  fields: Record<string, string>;
  /** Key the provider will store under, echoed back on confirm. */
  providerKey: string;
  expiresAt: string;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  createSignedUpload(input: SignedUploadRequest): Promise<SignedUploadTicket>;
  /**
   * Time-limited read URL, for private assets.
   *
   * The second argument is provider-shaped: Cloudinary needs the resource type
   * (it forms part of the delivery path), Supabase needs a TTL.
   */
  getSignedDownloadUrl(providerKey: string, resourceTypeOrTtl?: string | number): Promise<string>;
  /**
   * `resourceType` is the provider's own classification, captured at upload.
   * Cloudinary's destroy endpoint requires it and rejects `auto`.
   */
  delete(providerKey: string, resourceType?: string): Promise<void>;
  isConfigured(): boolean;
}

/**
 * Upload policy, enforced at SIGNING time.
 *
 * Rejecting an oversized or wrong-typed file before a signature is issued means
 * the bytes never leave the browser — far better than discovering the problem
 * after a 50 MB upload has already cost bandwidth.
 */
export const UPLOAD_LIMITS = {
  content: {
    maxBytes: 50 * 1024 * 1024, // 50 MB — lecture decks and long PDFs
    mimeTypes: [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'video/mp4',
      'video/webm',
      'image/png',
      'image/jpeg',
      'image/webp',
    ],
  },
  submission: {
    maxBytes: 25 * 1024 * 1024,
    mimeTypes: [
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'image/png',
      'image/jpeg',
      'text/plain',
    ],
  },
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
