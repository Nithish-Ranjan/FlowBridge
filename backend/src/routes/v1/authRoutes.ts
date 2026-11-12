import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import {
  getUserBySessionToken,
  invalidateSession,
  loginUser,
  registerUser,
  updateUserLanguagePreference,
} from '../../services/authService.js';
import { asyncHandler, HttpError } from './helpers.js';

export const authRouter: Router = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, fullName, businessName, languagePreference } = req.body ?? {};
    if (!email || !password || !fullName || !businessName) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'email, password, fullName, and businessName are required.');
    }
    const result = await registerUser({
      email,
      password,
      fullName,
      businessName,
      languagePreference,
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
    const demoEmail = 'owner@flowbridge.local';
    const demoPassword = 'FlowBridge123!';
    try {
      const result = await loginUser({ email: demoEmail, password: demoPassword });
      res.json(result);
    } catch {
      // Fallback: register demo user if not yet seeded
      const result = await registerUser({
        email: demoEmail,
        password: demoPassword,
        fullName: 'Demo Distributor Owner',
        businessName: 'Deccan FMCG Distributors',
      });
      res.json(result);
    }
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

authRouter.post(
  '/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { languagePreference } = req.body ?? {};
    if (languagePreference && ['en', 'hi', 'ta'].includes(languagePreference)) {
      await updateUserLanguagePreference(req.user!.id, languagePreference);
      req.user!.languagePreference = languagePreference;
    }
    res.json({ ok: true, user: req.user });
  }),
);
