import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import {
  getUserBySessionToken,
  invalidateSession,
  loginUser,
  registerUser,
} from '../../services/authService.js';
import { asyncHandler, HttpError } from './helpers.js';

export const authRouter: Router = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, fullName, businessName } = req.body ?? {};
    if (!email || !password || !fullName || !businessName) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'email, password, fullName, and businessName are required.');
    }
    const result = await registerUser({
      email,
      password,
      fullName,
      businessName,
    });
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'email and password are required.');
    }
    const result = await loginUser({ email, password });
    res.json(result);
  }),
);

authRouter.post(
  '/demo-login',
  asyncHandler(async (_req, res) => {
    // Convenience endpoint for demo/evaluation
    const demoAccounts = [
      { email: 'demo@flowbridge.fintech', password: 'Demo@FlowBridge2026' },
      { email: 'owner@flowbridge.local', password: 'FlowBridge123!' },
    ];

    for (const cred of demoAccounts) {
      try {
        const result = await loginUser(cred);
        res.json(result);
        return;
      } catch {
        // try next
      }
    }

    // Fallback: register demo user if not yet seeded
    const result = await registerUser({
      email: 'demo@flowbridge.fintech',
      password: 'Demo@FlowBridge2026',
      fullName: 'Rajesh Sharma (Demo Owner)',
      businessName: 'Sharma Distribution Hub',
    });
    res.json(result);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await invalidateSession(req.sessionToken);
    }
    res.json({ ok: true });
  }),
);
