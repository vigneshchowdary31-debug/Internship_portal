import { Router, Request, Response } from 'express';
import { GoogleService } from '../services/google.service';

const router = Router();

router.get('/auth', (req: Request, res: Response) => {
  try {
    const url = GoogleService.getAuthUrl();
    res.redirect(url);
  } catch (error: any) {
    console.error(`Error in /auth:\n${error.stack || error.message}`);
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

    // The destination variable depends on which scopes were just granted, and
    // getting it wrong is destructive: pasting a gmail.send token into
    // GOOGLE_REFRESH_TOKEN silently breaks Calendar/Meet, while leaving
    // GMAIL_REFRESH_TOKEN stale. The scope string is authoritative, so derive
    // the instruction from it instead of hardcoding one variable name.
    const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
    const isGmailGrant = grantedScopes.some(
      (scope) => scope.includes('gmail.') || scope === 'https://mail.google.com/'
    );
    const targetVar = isGmailGrant ? 'GMAIL_REFRESH_TOKEN' : 'GOOGLE_REFRESH_TOKEN';

    res.status(200).json({
      success: true,
      message:
        `OAuth successful. 1. Copy "refresh_token" below. 2. Paste it into ${targetVar} ` +
        `in your .env (and in the Render dashboard). 3. Restart the backend.`,
      grantedScopes,
      pasteInto: targetVar,
      warning:
        `This grant is for [${grantedScopes.join(', ')}]. Pasting it into the other ` +
        'refresh-token variable will break that integration — each token only carries ' +
        'the scopes it was granted.',
      tokens,
    });
  } catch (error: any) {
    console.error(`Error in /oauth/callback:\n${error.stack || error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
