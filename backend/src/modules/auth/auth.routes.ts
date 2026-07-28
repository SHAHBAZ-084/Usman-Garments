import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as authService from './auth.service';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await authService.login(username.trim(), password);

    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    req.session.userId = user.id;
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.session.userId!);

    if (!user) {
      req.session.destroy(() => {
        res.status(401).json({ error: 'Not authenticated' });
      });
      return;
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const body = req.body as authService.UpdateProfileInput;
    const user = await authService.updateProfile(req.session.userId!, {
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      role: typeof body.role === 'string' ? body.role : undefined,
      username: typeof body.username === 'string' ? body.username : undefined,
      currentPassword: typeof body.currentPassword === 'string' ? body.currentPassword : undefined,
      newPassword: typeof body.newPassword === 'string' ? body.newPassword : undefined,
    });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/verify-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword } = req.body as { currentPassword?: string };
    const result = await authService.verifyCurrentPassword(
      req.session.userId!,
      typeof currentPassword === 'string' ? currentPassword : '',
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});
