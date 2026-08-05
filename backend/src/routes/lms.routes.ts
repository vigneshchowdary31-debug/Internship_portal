import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as lms from '../controllers/lms.controller';
import {
  createLearningPathSchema,
  updateLearningPathSchema,
  cloneLearningPathSchema,
  learningPathStatusSchema,
  createModuleSchema,
  updateModuleSchema,
  setPrerequisitesSchema,
  createContentSchema,
  updateContentSchema,
  contentStatusSchema,
  createOverrideSchema,
  reorderSchema,
  idParamSchema,
  signUploadSchema,
  confirmUploadSchema,
  assignStudentSchema,
  searchContentSchema,
  listContentsSchema,
  listNotificationsSchema,
  learningPathProgressSchema,
} from '../validators/lms.validator';

/**
 * LMS routes — Phase 1 (curriculum, content, storage).
 *
 * Authorization is NOT done with restrictTo() here. The rules are relational
 * ("batches I am assigned to"), which a role gate cannot express, so every
 * handler consults the policy layer instead. `authenticate` still applies to
 * everything.
 */
const router = Router();

router.use(authenticate);

// --- Student's own curriculum (declared before /:id routes) -----------------
router.get('/me/curriculum', lms.getMyCurriculum);
router.get('/me/resume', lms.getMyResumePoint);
router.get('/me/progress/:id', validate(learningPathProgressSchema), lms.getMyProgress);

// --- Search (declared before /:id routes) ------------------------------------
router.get('/contents/search', validate(searchContentSchema), lms.searchContent);
router.get('/contents/facets', lms.contentFacets);

// --- Notifications ----------------------------------------------------------
router.get('/notifications', validate(listNotificationsSchema), lms.listNotifications);
router.get('/notifications/unread-count', lms.notificationUnreadCount);
router.patch('/notifications/read-all', lms.markAllNotificationsRead);
router.patch('/notifications/:id/read', validate(idParamSchema), lms.markNotificationRead);

// --- Batch progress ---------------------------------------------------------
router.get('/batches/:id/progress', validate(idParamSchema), lms.getBatchProgress);

// --- Uploads ----------------------------------------------------------------
router.post('/uploads/sign', validate(signUploadSchema), lms.signUpload);
router.post('/uploads/confirm', validate(confirmUploadSchema), lms.confirmUpload);

// --- Learning paths ---------------------------------------------------------
router.get('/learning-paths', lms.listLearningPaths);
router.post('/learning-paths', validate(createLearningPathSchema), lms.createLearningPath);
router.get('/learning-paths/:id', validate(idParamSchema), lms.getLearningPath);
router.patch('/learning-paths/:id', validate(updateLearningPathSchema), lms.updateLearningPath);
router.delete('/learning-paths/:id', validate(idParamSchema), lms.deleteLearningPath);
router.post('/learning-paths/:id/clone', validate(cloneLearningPathSchema), lms.cloneLearningPath);
router.patch(
  '/learning-paths/:id/status',
  validate(learningPathStatusSchema),
  lms.setLearningPathStatus
);

// Modules nested under a path
router.get('/learning-paths/:id/modules', validate(idParamSchema), lms.listModules);
router.post('/learning-paths/:id/modules', validate(createModuleSchema), lms.createModule);
router.patch('/learning-paths/:id/modules/reorder', validate(reorderSchema), lms.reorderModules);

// --- Modules ----------------------------------------------------------------
router.patch('/modules/:id', validate(updateModuleSchema), lms.updateModule);
router.delete('/modules/:id', validate(idParamSchema), lms.deleteModule);
router.put('/modules/:id/prerequisites', validate(setPrerequisitesSchema), lms.setModulePrerequisites);

// Content nested under a module
router.get('/modules/:id/contents', validate(listContentsSchema), lms.listContents);
router.post('/modules/:id/contents', validate(createContentSchema), lms.createContent);
router.patch('/modules/:id/contents/reorder', validate(reorderSchema), lms.reorderContents);

// --- Content ----------------------------------------------------------------
router.patch('/contents/:id', validate(updateContentSchema), lms.updateContent);
router.delete('/contents/:id', validate(idParamSchema), lms.deleteContent);
router.patch('/contents/:id/status', validate(contentStatusSchema), lms.setContentStatus);
router.post('/contents/:id/override', validate(createOverrideSchema), lms.createContentOverride);

// Student interaction tracking
router.post('/contents/:id/view', validate(idParamSchema), lms.recordContentView);
router.post('/contents/:id/download', validate(idParamSchema), lms.recordContentDownload);
router.post('/contents/:id/open', validate(idParamSchema), lms.recordContentOpen);
router.post('/contents/:id/complete', validate(idParamSchema), lms.markContentComplete);

export default router;
