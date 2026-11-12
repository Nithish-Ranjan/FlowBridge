import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { getEnv } from './config/env.js';
import { checkDatabaseHealth } from './db/pool.js';
import {
  createRateLimiter,
  rejectForbiddenCredentials,
  securityHeaders,
  structuredLogger,
} from './middleware/security.js';
import { HttpError } from './routes/v1/helpers.js';
import { createV1Router } from './routes/v1/index.js';

export interface CreateAppOptions {
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(structuredLogger);
  app.use(
    createRateLimiter({
      windowMs: options.rateLimitWindowMs,
      maxRequests: options.rateLimitMax,
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(rejectForbiddenCredentials);

  app.get('/api/health', async (_req, res, next) => {
    try {
      const db = await checkDatabaseHealth();
      res.json({ ok: db.ok, database: db.databaseName, version: db.serverVersion });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1', createV1Router());

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Endpoint not found under /api/v1.',
      },
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }

    const pgErr = err as { code?: string; type?: string; detail?: string; message?: string };
    if (pgErr?.type === 'entity.parse.failed') {
      res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON request body.',
        },
      });
      return;
    }

    if (pgErr?.code === '23505') {
      res.status(409).json({
        error: {
          code: 'DUPLICATE_CONFLICT',
          message: 'Duplicate record violates uniqueness constraint.',
          details: pgErr.detail ?? pgErr.message,
        },
      });
      return;
    }
    if (pgErr?.code === '23503' || pgErr?.code === '23514' || pgErr?.code === 'P0001') {
      res.status(400).json({
        error: {
          code: 'INTEGRITY_VIOLATION',
          message: pgErr.detail ?? pgErr.message ?? 'Database integrity constraint violation.',
        },
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    const isNotFound = message.toLowerCase().includes('not found');
    res.status(isNotFound ? 404 : 400).json({
      error: {
        code: isNotFound ? 'NOT_FOUND' : 'REQUEST_FAILED',
        message,
      },
    });
  });

  return app;
}
