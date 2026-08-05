import { z } from 'zod';

const id = z.string().uuid('Invalid id format');
const title = z.string().trim().min(2, 'Must be at least 2 characters').max(200);

/**
 * Release scheduling accepts an ISO datetime or null.
 * Null means "release immediately" — the resolver treats a null releaseAt as
 * already released, so there is no separate "publish now" concept.
 */
const releaseAt = z
  .string()
  .datetime({ message: 'Release time must be an ISO datetime' })
  .nullable()
  .optional();

// --- Learning paths ---------------------------------------------------------

export const createLearningPathSchema = z.object({
  body: z.object({
    techStackId: id,
    name: title,
    version: z.string().trim().min(1, 'A version label is required').max(40),
    description: z.string().trim().max(1000).optional(),
    isDefault: z.boolean().optional(),
  }),
});

export const updateLearningPathSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    name: title.optional(),
    version: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isDefault: z.boolean().optional(),
  }),
});

export const cloneLearningPathSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    name: title,
    version: z.string().trim().min(1, 'A version label is required').max(40),
    description: z.string().trim().max(1000).optional(),
  }),
});

export const learningPathStatusSchema = z.object({
  params: z.object({ id }),
  body: z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']) }),
});

// --- Modules ----------------------------------------------------------------

export const createModuleSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    name: title,
    description: z.string().trim().max(2000).optional(),
    estimatedDurationMinutes: z.number().int().min(1).max(100000).optional(),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
    thumbnailAssetId: id.nullable().optional(),
  }),
});

export const updateModuleSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    name: title.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    isVisible: z.boolean().optional(),
    estimatedDurationMinutes: z.number().int().min(1).max(100000).nullable().optional(),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).nullable().optional(),
    thumbnailAssetId: id.nullable().optional(),
  }),
});

export const setPrerequisitesSchema = z.object({
  params: z.object({ id }),
  body: z.object({ moduleIds: z.array(id).max(20, 'At most 20 prerequisites') }),
});

// --- Content ----------------------------------------------------------------

const contentType = z.enum(['PDF', 'PPT', 'DOCX', 'GITHUB_REPO', 'RECORDING', 'LINK', 'VIDEO', 'REFERENCE']);

export const createContentSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    title,
    description: z.string().trim().max(2000).optional(),
    type: contentType,
    assetId: id.nullable().optional(),
    externalUrl: z.string().trim().url('Must be a valid URL').max(2000).nullable().optional(),
    releaseAt,
    scope: z.enum(['LEARNING_PATH', 'BATCH']).optional(),
    batchId: id.nullable().optional(),
  }),
});

export const updateContentSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    title: title.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    assetId: id.nullable().optional(),
    externalUrl: z.string().trim().url('Must be a valid URL').max(2000).nullable().optional(),
    releaseAt,
  }),
});

export const contentStatusSchema = z.object({
  params: z.object({ id }),
  body: z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']) }),
});

export const createOverrideSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    batchId: id,
    title: title.optional(),
    description: z.string().trim().max(2000).optional(),
    assetId: id.nullable().optional(),
    externalUrl: z.string().trim().url().max(2000).nullable().optional(),
  }),
});

export const reorderSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    orderedIds: z.array(id).min(1, 'At least one item is required'),
  }),
});

export const idParamSchema = z.object({ params: z.object({ id }) });

// --- Uploads ----------------------------------------------------------------

export const signUploadSchema = z.object({
  body: z.object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().positive('File appears to be empty'),
    purpose: z.enum(['content', 'submission']),
  }),
});

export const confirmUploadSchema = z.object({
  body: z.object({
    providerKey: z.string().trim().min(1).max(500),
    url: z.string().trim().url().max(2000),
    originalFilename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().positive(),
    purpose: z.enum(['content', 'submission']),
    // Echoed straight from the provider's upload response. Constrained to the
    // set Cloudinary's destroy endpoint accepts, so a bad value fails here
    // rather than at delete time when the asset is already stored.
    resourceType: z.enum(['image', 'raw', 'video']).optional(),
    format: z.string().trim().max(32).optional(),
    checksum: z.string().trim().max(128).optional(),
  }),
});

// --- Batch membership -------------------------------------------------------

export const assignStudentSchema = z.object({
  params: z.object({ id }),
  body: z.object({ studentId: id }),
});


// --- Search, pagination, notifications (Phase 2) -----------------------------

/**
 * Pagination is parsed from the query string, so values arrive as strings.
 * Coerced rather than rejected: `?page=2` is the natural thing for a client to
 * send, and failing it would be pedantry.
 */
const pageNumber = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();

export const searchContentSchema = z.object({
  query: z.object({
    q: z.string().trim().max(200).optional(),
    learningPathId: id.optional(),
    moduleId: id.optional(),
    type: z
      .enum(['PDF', 'PPT', 'DOCX', 'GITHUB_REPO', 'RECORDING', 'LINK', 'VIDEO', 'REFERENCE'])
      .optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    scope: z.enum(['LEARNING_PATH', 'BATCH']).optional(),
    batchId: id.optional(),
    page: pageNumber,
    pageSize,
  }),
});

export const listContentsSchema = z.object({
  params: z.object({ id }),
  query: z.object({ page: pageNumber, pageSize }),
});

export const listNotificationsSchema = z.object({
  query: z.object({
    unreadOnly: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    page: pageNumber,
    pageSize,
  }),
});

export const learningPathProgressSchema = z.object({
  params: z.object({ id }),
});
