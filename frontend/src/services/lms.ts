import api from './api';

/**
 * Typed client for the LMS API.
 *
 * Every LMS request goes through here so the shapes live in one place rather
 * than being re-declared as `any` at each call site.
 */

export type LearningPathStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ContentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ContentType =
  | 'PDF'
  | 'PPT'
  | 'DOCX'
  | 'GITHUB_REPO'
  | 'RECORDING'
  | 'LINK'
  | 'VIDEO'
  | 'REFERENCE';
export type ModuleDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type VisibilityScope = 'LEARNING_PATH' | 'BATCH';

/** Content types whose payload is an uploaded file rather than a URL. */
export const ASSET_CONTENT_TYPES: ContentType[] = ['PDF', 'PPT', 'DOCX', 'VIDEO'];
export const URL_CONTENT_TYPES: ContentType[] = ['GITHUB_REPO', 'RECORDING', 'LINK'];
/** Reference material takes a file OR a link — the only type that accepts either. */
export const EITHER_CONTENT_TYPES: ContentType[] = ['REFERENCE'];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  PDF: 'PDF Notes',
  PPT: 'Presentation',
  DOCX: 'Document',
  VIDEO: 'Video',
  GITHUB_REPO: 'GitHub Repository',
  RECORDING: 'Class Recording',
  LINK: 'External Link',
  REFERENCE: 'Reference Material',
};

export interface LearningPath {
  id: string;
  techStackId: string;
  name: string;
  version: string;
  description: string | null;
  status: LearningPathStatus;
  isDefault: boolean;
  clonedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  techStack: { id: string; name: string };
  _count: { modules: number; batches: number };
}

export interface LmsModule {
  id: string;
  learningPathId: string;
  name: string;
  description: string | null;
  position: number;
  isVisible: boolean;
  estimatedDurationMinutes: number | null;
  difficulty: ModuleDifficulty | null;
  thumbnailAssetId: string | null;
  thumbnail: { id: string; url: string; originalFilename: string } | null;
  originId: string | null;
  createdAt: string;
  updatedAt: string;
  prerequisites: { prerequisite: { id: string; name: string } }[];
  _count: { contents: number };
  /** Present on the student curriculum response; absent in the admin builder. */
  progress?: ModuleProgress;
}

export interface ModuleProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface LmsContent {
  id: string;
  moduleId: string;
  learningPathId: string;
  title: string;
  description: string | null;
  type: ContentType;
  status: ContentStatus;
  position: number;
  scope: VisibilityScope;
  batchId: string | null;
  overridesId: string | null;
  releaseAt: string | null;
  externalUrl: string | null;
  version: number;
  asset: {
    id: string;
    url: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
  batch: { id: string; name: string } | null;
  overriddenBy: { id: string; batchId: string | null } | null;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
}

export interface TransferPreview {
  isMove: boolean;
  currentBatch: { id: string; name: string; learningPathId: string | null } | null;
  targetBatch: { id: string; name: string; learningPathId: string | null };
  crossesLearningPath: boolean;
  newModuleCount: number;
  retainedModuleCount: number;
}

export interface MyCurriculum {
  batch: {
    id: string;
    name: string;
    learningPath: { id: string; name: string; version: string } | null;
    techStack: { id: string; name: string } | null;
  } | null;
  learningPath: { id: string; name: string; version: string } | null;
  modules: LmsModule[];
  /** Weighted across every visible item, not an average of module percentages. */
  progress?: ModuleProgress;
  /**
   * Assignment and quiz completion, returned ALONGSIDE `progress` rather than
   * folded into it (Phase 3 M2/M3). Both are derived server-side from the
   * Submission and Attempt tables — there is no stored counter to go stale.
   */
  assignmentProgress?: {
    total: number;
    submitted: number;
    late: number;
    graded: number;
    percent: number;
    averageScorePercent: number | null;
  };
  quizProgress?: {
    total: number;
    attempted: number;
    percent: number;
    averageScorePercent: number | null;
  };
}

// --- Phase 2: search, notifications, progress -------------------------------

export interface Paged<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; hasMore: boolean; totalPages?: number };
}

export interface ContentSearchResult extends LmsContent {
  module: { id: string; name: string } | null;
  learningPath: { id: string; name: string; version: string } | null;
}

export interface ContentFilters {
  q?: string;
  learningPathId?: string;
  moduleId?: string;
  type?: ContentType;
  status?: ContentStatus;
  scope?: VisibilityScope;
  batchId?: string;
  page?: number;
  pageSize?: number;
}

export interface AppNotification {
  id: string;
  readAt: string | null;
  createdAt: string;
  notification: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    linkUrl: string | null;
    entityType: string | null;
    entityId: string | null;
    createdAt: string;
    batch: { id: string; name: string } | null;
  };
}

/** Write payload for a content item. Mirrors the server-side validator. */
export interface ContentPayload {
  title: string;
  description?: string;
  type?: ContentType;
  assetId?: string | null;
  externalUrl?: string | null;
  releaseAt?: string | null;
  scope?: VisibilityScope;
  batchId?: string | null;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const lmsApi = {
  // --- Learning paths ---
  listPaths: (techStackId?: string) =>
    api
      .get('/lms/learning-paths', { params: techStackId ? { techStackId } : {} })
      .then(unwrap<LearningPath[]>),
  createPath: (body: {
    techStackId: string;
    name: string;
    version: string;
    description?: string;
    isDefault?: boolean;
  }) => api.post('/lms/learning-paths', body).then(unwrap<LearningPath>),
  updatePath: (id: string, body: Partial<Pick<LearningPath, 'name' | 'version' | 'description' | 'isDefault'>>) =>
    api.patch(`/lms/learning-paths/${id}`, body).then(unwrap<LearningPath>),
  clonePath: (id: string, body: { name: string; version: string; description?: string }) =>
    api.post(`/lms/learning-paths/${id}/clone`, body).then(unwrap<LearningPath>),
  setPathStatus: (id: string, status: LearningPathStatus) =>
    api.patch(`/lms/learning-paths/${id}/status`, { status }).then(unwrap<LearningPath>),
  deletePath: (id: string) => api.delete(`/lms/learning-paths/${id}`),

  // --- Modules ---
  listModules: (pathId: string) =>
    api.get(`/lms/learning-paths/${pathId}/modules`).then(unwrap<LmsModule[]>),
  createModule: (
    pathId: string,
    body: {
      name: string;
      description?: string;
      estimatedDurationMinutes?: number;
      difficulty?: ModuleDifficulty;
      thumbnailAssetId?: string | null;
    }
  ) => api.post(`/lms/learning-paths/${pathId}/modules`, body).then(unwrap<LmsModule>),
  updateModule: (id: string, body: Record<string, unknown>) =>
    api.patch(`/lms/modules/${id}`, body).then(unwrap<LmsModule>),
  reorderModules: (pathId: string, orderedIds: string[]) =>
    api.patch(`/lms/learning-paths/${pathId}/modules/reorder`, { orderedIds }).then(unwrap<LmsModule[]>),
  setPrerequisites: (id: string, moduleIds: string[]) =>
    api.put(`/lms/modules/${id}/prerequisites`, { moduleIds }).then(unwrap<LmsModule>),
  deleteModule: (id: string) => api.delete(`/lms/modules/${id}`),

  // --- Content ---
  listContents: (moduleId: string, batchId?: string) =>
    api
      .get(`/lms/modules/${moduleId}/contents`, { params: batchId ? { batchId } : {} })
      .then(unwrap<LmsContent[]>),
  createContent: (moduleId: string, body: ContentPayload) =>
    api.post(`/lms/modules/${moduleId}/contents`, body).then(unwrap<LmsContent>),
  updateContent: (id: string, body: ContentPayload) =>
    api.patch(`/lms/contents/${id}`, body).then(unwrap<LmsContent>),
  setContentStatus: (id: string, status: ContentStatus) =>
    api.patch(`/lms/contents/${id}/status`, { status }).then(unwrap<LmsContent>),
  createOverride: (id: string, body: { batchId: string; title?: string }) =>
    api.post(`/lms/contents/${id}/override`, body).then(unwrap<LmsContent>),
  reorderContents: (moduleId: string, orderedIds: string[]) =>
    api.patch(`/lms/modules/${moduleId}/contents/reorder`, { orderedIds }).then(unwrap<LmsContent[]>),
  deleteContent: (id: string) => api.delete(`/lms/contents/${id}`),

  // --- Student interaction ---
  recordView: (id: string) => api.post(`/lms/contents/${id}/view`),
  recordDownload: (id: string) => api.post(`/lms/contents/${id}/download`),
  recordOpen: (id: string) => api.post(`/lms/contents/${id}/open`),
  markComplete: (id: string) => api.post(`/lms/contents/${id}/complete`),

  // --- Student curriculum ---
  myCurriculum: () => api.get('/lms/me/curriculum').then(unwrap<MyCurriculum>),

  // --- Batch membership ---
  previewAssignment: (batchId: string, studentId: string) =>
    api.post(`/batches/${batchId}/students/preview`, { studentId }).then(unwrap<TransferPreview>),
  assignStudent: (batchId: string, studentId: string) =>
    api.post(`/batches/${batchId}/students/assign`, { studentId }),

  // --- Search (Phase 2) ---
  searchContent: (filters: ContentFilters) =>
    api
      .get('/lms/contents/search', { params: pruneEmpty(filters) })
      .then((res) => ({ items: res.data.data, meta: res.data.meta }) as Paged<ContentSearchResult>),
  contentFacets: (filters: { learningPathId?: string; moduleId?: string }) =>
    api
      .get('/lms/contents/facets', { params: pruneEmpty(filters) })
      .then(unwrap<{ types: { value: string; count: number }[]; statuses: { value: string; count: number }[] }>),

  // --- Notifications (Phase 2) ---
  listNotifications: (params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) =>
    api
      .get('/lms/notifications', { params: pruneEmpty(params) })
      .then((res) => ({ items: res.data.data, meta: res.data.meta }) as Paged<AppNotification>),
  unreadCount: () =>
    api.get('/lms/notifications/unread-count').then(unwrap<{ unread: number }>),
  markNotificationRead: (id: string) => api.patch(`/lms/notifications/${id}/read`),
  markAllNotificationsRead: () => api.patch('/lms/notifications/read-all'),

  // --- Progress (Phase 2) ---
  myProgress: (learningPathId: string) =>
    api
      .get(`/lms/me/progress/${learningPathId}`)
      .then(unwrap<{ modules: (ModuleProgress & { moduleId: string })[]; overall: ModuleProgress }>),
  myResumePoint: () =>
    api.get('/lms/me/resume').then(
      unwrap<{
        lastViewedAt: string;
        content: { id: string; title: string; type: ContentType; moduleId: string; module: { name: string } };
      } | null>
    ),
  batchProgress: (batchId: string) =>
    api.get(`/lms/batches/${batchId}/progress`).then(
      unwrap<{
        studentCount: number;
        modules: { moduleId: string; items: { contentId: string; title: string; completedBy: number }[] }[];
      }>
    ),
};

/**
 * Drops empty values so a blank filter never reaches the server as `?q=`.
 *
 * The validators reject an empty uuid, so sending `moduleId=""` for "no module
 * filter" would 400 the whole search rather than widening it.
 */
function pruneEmpty<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ) as Partial<T>;
}

/**
 * What the provider actually returned for one uploaded file.
 *
 * These are the values the SERVER needs to be able to delete the file later, so
 * they are carried through verbatim rather than re-derived:
 *
 *   - `providerKey` is the public_id Cloudinary RETURNED. For `raw` assets it
 *     carries the extension; the key we signed does not.
 *   - `resourceType` is Cloudinary's own classification. It cannot be inferred
 *     from the MIME type — Cloudinary files PDFs as `image`, not `raw`.
 */
export interface ProviderUpload {
  providerKey: string;
  url: string;
  resourceType: 'image' | 'raw' | 'video';
  format?: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Signs, then uploads a file straight to the storage provider — and stops there.
 *
 * The file never touches our own server: we ask for a signature and POST the
 * file directly to the provider. That keeps the API's 10 kB JSON body limit
 * untouched and costs the backend zero bandwidth.
 *
 * Registering the result is a SEPARATE step, because the two callers register
 * differently: content calls `/lms/uploads/confirm` itself (below), while a
 * submission hands these values to `POST /submissions`, which calls
 * `confirmUpload()` server-side. Splitting the function is what lets the
 * submission flow avoid creating a MediaAsset for work that then fails its own
 * validation.
 */
export async function uploadToProvider(
  file: File,
  purpose: 'content' | 'submission',
  onProgress?: (percent: number) => void
): Promise<ProviderUpload> {
  const ticket = await api
    .post('/lms/uploads/sign', {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      purpose,
    })
    .then(unwrap<{ uploadUrl: string; fields: Record<string, string>; providerKey: string }>);

  const form = new FormData();
  Object.entries(ticket.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file);

  // XHR rather than fetch: fetch still has no upload-progress event, and a
  // 50 MB lecture deck without a progress bar feels broken.
  const uploaded = await new Promise<{
    secure_url?: string;
    url?: string;
    public_id?: string;
    resource_type?: string;
    format?: string;
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ticket.uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('The storage provider returned an unreadable response.'));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(form);
  });

  const url = uploaded.secure_url || uploaded.url;
  if (!url) throw new Error('The storage provider did not return a file URL.');

  // `auto` is an UPLOAD-only convenience — the destroy endpoint rejects it with
  // a 400, so a file registered under it could never be deleted. Cloudinary
  // resolves it to a real type in the response; if it somehow did not, failing
  // here is far better than storing an undeletable asset.
  const resourceType = uploaded.resource_type;
  if (resourceType !== 'image' && resourceType !== 'raw' && resourceType !== 'video') {
    throw new Error(
      `The storage provider returned an unusable file type ("${resourceType ?? 'none'}"). Please try again.`
    );
  }

  return {
    // The public_id Cloudinary RETURNED, not the one we signed: for `raw`
    // assets (DOCX/PPTX/ZIP) Cloudinary appends the extension, and storing
    // the signed key makes every later delete silently do nothing.
    providerKey: uploaded.public_id ?? ticket.providerKey,
    url,
    resourceType,
    format: uploaded.format,
    originalFilename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  };
}

/**
 * Uploads a file and registers it as a MediaAsset in one step.
 *
 * The content authoring path. Submissions deliberately do NOT use this — see
 * `uploadToProvider`.
 */
export async function uploadFile(
  file: File,
  purpose: 'content' | 'submission',
  onProgress?: (percent: number) => void
): Promise<{ id: string; url: string; originalFilename: string }> {
  const uploaded = await uploadToProvider(file, purpose, onProgress);

  return api
    .post('/lms/uploads/confirm', { ...uploaded, purpose })
    .then(unwrap<{ id: string; url: string; originalFilename: string }>);
}
