import { Router, Request, Response } from 'express';
import { GoogleService } from '../services/google.service';

const router = Router();

router.get('/auth', (req: Request, res: Response) => {
  try {
    const url = GoogleService.getAuthUrl();
    res.redirect(url);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/oauth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).json({ success: false, message: 'No code provided' });
  }

  try {
    const tokens = await GoogleService.getTokensFromCode(code);
    res.status(200).json({
      success: true,
      message: 'OAuth successful. 1. Copy the refresh token below. 2. Paste into GOOGLE_REFRESH_TOKEN in your .env file. 3. Restart the backend.',
      tokens
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
