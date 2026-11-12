import type { NextFunction, Request, Response } from 'express';
import { findForbiddenCredentialKey } from '@flowbridge/shared';

const SENSITIVE_LOG_KEYS = new Set([
  'rawvalue',
  'payeridentifierraw',
  'payer_identifier',
  'payer_upi',
  'payer_account',
  'upipin',
  'upi_pin',
  'pin',
  'otp',
  'password',
  'secret',
  'authorization',
  'csvtext',
]);

export function redactForLog(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_LOG_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactForLog(v);
    }
  }
  return out;
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
}

export function createRateLimiter(options: { windowMs?: number; maxRequests?: number } = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 240;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'local';
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      next();
      return;
    }

    existing.count += 1;
    const remaining = Math.max(0, maxRequests - existing.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (existing.count > maxRequests) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests; please slow down and retry shortly.',
        },
      });
      return;
    }

    next();
  };
}

export function structuredLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    };
    console.log(JSON.stringify(entry));
  });
  next();
}

export function rejectForbiddenCredentials(req: Request, res: Response, next: NextFunction): void {
  const hit = findForbiddenCredentialKey(req.body);
  if (hit) {
    res.status(400).json({
      error: {
        code: 'FORBIDDEN_CREDENTIAL_FIELD',
        message: `Forbidden credential field "${hit}" rejected. FlowBridge never stores UPI PINs, OTPs, passwords, or card credentials.`,
      },
    });
    return;
  }
  next();
}

