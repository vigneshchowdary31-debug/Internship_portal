import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { asyncHandler } from '../utils/asyncHandler';

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserService.createUser(req.body);
  res.status(201).json({
    success: true,
    data: user,
  });
});

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.query;
  const users = await UserService.getUsers(role as string);
  res.status(200).json({
    success: true,
    data: users,
  });
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserService.getUserById(req.params.id);
  res.status(200).json({
    success: true,
    data: user,
  });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserService.updateUser(req.params.id, req.body);
  res.status(200).json({
    success: true,
    data: user,
  });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  // Use the authenticated user's ID
  const user = await UserService.updateProfile(req.user.id, req.body);
  res.status(200).json({
    success: true,
    data: user,
    message: 'Profile updated successfully',
  });
});
