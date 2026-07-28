import { Router } from 'express';
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  updateProfile,
} from '../controllers/user.controller';
import { validate } from '../middlewares/validate.middleware';
import { createUserSchema, updateUserSchema, updateProfileSchema } from '../validators/user.validator';

import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// All authenticated users can update their own profile
router.patch('/profile', validate(updateProfileSchema), updateProfile);

// Admin-only routes
router.use(restrictTo('ADMIN'));

router.post('/', validate(createUserSchema), createUser);
router.get('/', getUsers);
router.get('/:id', getUserById);
router.patch('/:id', validate(updateUserSchema), updateUser);

export default router;
