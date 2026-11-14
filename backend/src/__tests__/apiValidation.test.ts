import { beforeAll, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Express, Request, Response } from 'express';
import { getEnv, resetEnvCacheForTests } from '../config/env.js';
import { createApp } from '../app.js';
import {
  AllocatePaymentSchema,
  CommitmentCreateSchema,
  CommitmentStatusUpdateSchema,
  ImportBankTransactionsSchema,
  ScenarioCreateSchema,
} from '../validation/schemas.js';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/flowbridge_test';
  process.env.IDENTIFIER_HMAC_SECRET = 'test-identifier-hmac-secret-123456';
  process.env.TX_FINGERPRINT_SECRET = 'test-tx-fingerprint-secret-123456';
  resetEnvCacheForTests();
});

async function dispatchJson(
  app: Express,
  method: string,
  url: string,
  body?: unknown,
): Promise<{
  status: number;
  headers: Record<string, string | string[]>;
  body: { error?: { code?: string; message?: string; details?: unknown } } & Record<string, unknown>;
}> {
  const raw = body !== undefined ? JSON.stringify(body) : '';
  const req = new PassThrough() as unknown as Request & PassThrough & { _body: boolean };
  Object.assign(req, {
    method,
    url,
    originalUrl: url,
    ip: '127.0.0.1',
    headers: {
      ...(body !== undefined
        ? {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(raw)),
          }
        : {}),
    },
    _body: true,
    body: body ?? {},
    socket: { remoteAddress: '127.0.0.1' },
    connection: { remoteAddress: '127.0.0.1' },
  });

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let statusCode = 200;
    const headers: Record<string, string | string[]> = {};

    const res = new PassThrough() as unknown as Response & PassThrough;
    Object.assign(res, {
      statusCode: 200,
      locals: {},
      setHeader(name: string, val: string | string[]) {
        headers[name.toLowerCase()] = val;
        return res;
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()];
      },
      removeHeader(name: string) {
        delete headers[name.toLowerCase()];
      },
      status(code: number) {
        statusCode = code;
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        resolve({ status: statusCode, headers, body: payload });
        return res;
      },
      send(payload: unknown) {
        const parsed =
          typeof payload === 'string'
            ? (JSON.parse(payload) as Record<string, unknown>)
            : (payload as Record<string, unknown>);
        resolve({ status: statusCode, headers, body: parsed });
        return res;
      },
      end(chunk?: Buffer | string) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: statusCode,
          headers,
          body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        });
        return res;
      },
    });

    (app as unknown as (req: Request, res: Response) => void)(req, res);
  });
}

describe('Environment, Security Middleware & /api/v1 Boundary Validation', () => {
  it('validates env configuration via Zod', () => {
    const env = getEnv();
    expect(env.DATABASE_URL).toContain('postgresql://');
  });

  it('sets protective HTTP security headers on /api/v1 requests', async () => {
    const app = createApp();
    const res = await dispatchJson(app, 'GET', '/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.error?.code).toBe('ROUTE_NOT_FOUND');
  });

  it('enforces API rate limits and returns structured 429 error', async () => {
    const app = createApp({ rateLimitMax: 2, rateLimitWindowMs: 60_000 });
    const r1 = await dispatchJson(app, 'GET', '/api/unknown');
    const r2 = await dispatchJson(app, 'GET', '/api/unknown');
    const r3 = await dispatchJson(app, 'GET', '/api/unknown');

    expect(r1.status).toBe(404);
    expect(r2.status).toBe(404);
    expect(r3.status).toBe(429);
    expect(r3.body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('rejects forbidden sensitive credential fields (UPI PIN, OTP, CVV, password) at API boundary', async () => {
    const app = createApp();
    const res = await dispatchJson(
      app,
      'POST',
      '/api/v1/payments/manual?businessId=00000000-0000-0000-0000-000000000001',
      {
        amountPaise: '100000',
        upiPin: '1234',
        transactionTimestamp: '2026-11-11T09:00:00Z',
        valueDate: '2026-11-11',
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('FORBIDDEN_CREDENTIAL_FIELD');
    expect(res.body.error?.message).toContain('upiPin');
  });

  it('rejects invalid non-integer paise amounts via Zod boundary on /api/v1/payments/manual', async () => {
    const app = createApp();
    const res = await dispatchJson(
      app,
      'POST',
      '/api/v1/payments/manual?businessId=00000000-0000-0000-0000-000000000001',
      {
        direction: 'INFLOW',
        paymentMethod: 'UPI',
        amountPaise: '1000.50',
        transactionTimestamp: '2026-11-11T09:00:00Z',
        valueDate: '2026-11-11',
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed UUID params cleanly on /api/v1/retailers/:retailerId', async () => {
    const app = createApp();
    const res = await dispatchJson(
      app,
      'GET',
      '/api/v1/retailers/not-a-uuid?businessId=00000000-0000-0000-0000-000000000001',
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ID');
  });

  it('rejects empty scenario evaluation requests on /api/v1/scenarios/evaluate', async () => {
    const app = createApp();
    // Empty actions array rejected at Zod boundary
    const resEmpty = await dispatchJson(
      app,
      'POST',
      '/api/v1/scenarios/evaluate?businessId=00000000-0000-0000-0000-000000000001',
      {
        horizonDays: 15,
        actions: [],
      },
    );
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('validates Zod schemas for imports, allocations, scenarios, and commitments', () => {
    expect(() =>
      ImportBankTransactionsSchema.parse({ filename: 'empty.csv' }),
    ).toThrow();

    expect(() =>
      AllocatePaymentSchema.parse({
        allocations: [{ invoiceId: '00000000-0000-0000-0000-000000000001', amountPaise: '-500' }],
      }),
    ).toThrow();

    const validScenario = ScenarioCreateSchema.parse({
      name: 'Shockwave Delay 3 Days',
      scenarioKind: 'SHOCKWAVE_WHAT_IF',
      horizonDays: 15,
      actions: [
        {
          targetType: 'CUSTOMER_INVOICE',
          targetId: '00000000-0000-0000-0000-000000000001',
          targetLabel: 'C-3301 +3d',
          actionType: 'DELAY_INFLOW',
          amountPaise: '2000000',
          originalDate: '2026-11-25',
          simulatedDate: '2026-11-28',
        },
      ],
    });
    expect(validScenario.horizonDays).toBe(15);

    const validCommitment = CommitmentCreateSchema.parse({
      counterpartyType: 'RETAILER',
      retailerId: '00000000-0000-0000-0000-000000000001',
      customerInvoiceId: '00000000-0000-0000-0000-000000000002',
      actionType: 'EARLY_RECEIPT',
      proposedAmountPaise: '2000000',
      proposedDate: '2026-11-15',
    });
    expect(validCommitment.actionType).toBe('EARLY_RECEIPT');

    const validReply = CommitmentStatusUpdateSchema.parse({
      status: 'AGREED',
      humanReplyBy: 'Ramesh Kirana',
      humanReplyChannel: 'WHATSAPP',
      agreedAmountPaise: '2000000',
      agreedDate: '2026-11-15',
    });
    expect(validReply.status).toBe('AGREED');
  });
});
