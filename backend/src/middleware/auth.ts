import type { NextFunction, Request, Response } from 'express';
import { getUserBySessionToken, type UserDTO } from '../services/authService.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserDTO;
      sessionToken?: string;
    }
  }
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.header('x-session-token');
  if (customHeader) {
    return customHeader.trim();
  }
  return null;
}

/**
 * Optional authentication: Populates `req.user` if a valid session token is provided.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractSessionToken(req);
  if (token) {
    req.sessionToken = token;
    const user = await getUserBySessionToken(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}

/**
 * Required authentication: Enforces valid session token.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required. Please log in.',
      },
    });
    return;
  }

  req.sessionToken = token;
  const user = await getUserBySessionToken(token);
  if (!user) {
    res.status(401).json({
      error: {
        code: 'INVALID_SESSION',
        message: 'Session has expired or is invalid. Please log in again.',
      },
    });
    return;
  }

  req.user = user;
  next();
}

