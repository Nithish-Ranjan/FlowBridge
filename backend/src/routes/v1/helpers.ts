import type { NextFunction, Request, Response } from 'express';
import { listBusinesses } from '../../db/repositories/businessRepo.js';
import { UuidSchema } from '../../validation/schemas.js';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

export function parseUuidParam(raw: unknown, fieldName: string): string {
  const parsed = UuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'INVALID_ID', `Invalid UUID for "${fieldName}"`, parsed.error.issues);
  }
  return parsed.data;
}

/**
 * Resolve business scope for `/api/v1` endpoints:
 * - Explicit `?businessId=` query parameter, `x-business-id` header, or `:businessId` param
 * - Otherwise the primary active business in PostgreSQL
 */
export async function resolveBusinessId(req: Request): Promise<string> {
  if (req.user?.businessId) {
    return req.user.businessId;
  }

  const explicit =
    (typeof req.params.businessId === 'string' && req.params.businessId) ||
    (typeof req.query.businessId === 'string' && req.query.businessId) ||
    req.header('x-business-id');

  if (explicit) {
    return parseUuidParam(explicit, 'businessId');
  }

  const businesses = await listBusinesses();
  if (businesses.length === 0) {
    throw new HttpError(
      404,
      'BUSINESS_NOT_FOUND',
      'No business configured yet. Run database seed or create a business first.',
    );
  }
  return businesses[0].id;
}

