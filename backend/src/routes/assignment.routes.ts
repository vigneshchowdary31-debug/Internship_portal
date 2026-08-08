import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as assignments from '../controllers/assignment.controller';
import {
  createAssignmentSchema,
  updateAssignmentSchema,
  listAssignmentsSchema,
  assignmentIdSchema,
} from '../validators/assignment.validator';

/**
 * Assignment routes — Phase 3, M1.
 *
 * Mounted at /api/assignments, matching the Phase 3 API contract. Like the
 * Phase 1/2 LMS routes, authorization is NOT expressed with `restrictTo()`:
 * the rules are relational ("batches I am assigned to"), so each handler
 * consults the policy layer. `authenticate` still applies to everything.
 */
const router = Router();

router.use(authenticate);

router.get('/', validate(listAssignmentsSchema), assignments.listAssignments);
router.post('/', validate(createAssignmentSchema), assignments.createAssignment);
router.get('/:id', validate(assignmentIdSchema), assignments.getAssignment);
router.patch('/:id', validate(updateAssignmentSchema), assignments.updateAssignment);
router.delete('/:id', validate(assignmentIdSchema), assignments.deleteAssignment);

export default router;
