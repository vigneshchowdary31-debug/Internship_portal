import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await AuthService.login(email, password);

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Since we are using stateless JWT, we just send a success message.
  // The client will remove the token from storage.
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * Returns the authenticated user.
 *
 * `name` and `email` are included because this is what the client rehydrates
 * its session from on a page refresh — omitting them leaves the UI rendering an
 * undefined display name. `mustChangePassword` drives the client-side redirect
 * to the change-password screen.
 */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const { id, name, email, role, status, mustChangePassword } = req.user!;

  res.status(200).json({
    success: true,
    data: { user: { id, name, email, role, status, mustChangePassword } },
  });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const user = await AuthService.changePassword(req.user!.id, currentPassword, newPassword);

  res.status(200).json({
    success: true,
    data: { user },
    message: 'Password changed successfully',
  });
});
