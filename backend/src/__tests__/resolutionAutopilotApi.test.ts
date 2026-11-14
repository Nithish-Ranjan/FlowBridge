import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { seedDemoData } from '../db/seed.js';
import { listCustomerInvoices } from '../db/repositories/ledgerRepo.js';
import { PassThrough } from 'node:stream';
import type { Express, Request, Response } from 'express';

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

    app(req, res, (err?: unknown) => {
      if (err) {
        resolve({
          status: 500,
          headers: {},
          body: { error: { message: err instanceof Error ? err.message : String(err) } },
        });
      }
    });
  });
}

describe('Resolution Autopilot — API Endpoint Integration', () => {
  it('exercises /api/v1/scenarios/evaluate with real seeded workspace', async () => {
    const { businessId } = await seedDemoData();
    const app = createApp();

    const invoices = await listCustomerInvoices(businessId);
    const openInvoice = invoices.find(
      (i) => i.status !== 'PAID' && BigInt(i.outstandingPaise) > 0n && i.dueDate > '2026-11-16',
    );
    expect(openInvoice).toBeDefined();

    // 1. Evaluate valid scenario action against real invoice (accelerate from dueDate to 2026-11-15)
    const validRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [
          {
            targetType: 'CUSTOMER_INVOICE',
            targetId: openInvoice!.id,
            targetLabel: openInvoice!.invoiceNumber,
            actionType: 'ACCELERATE_INFLOW',
            amountPaise: '100000', // ₹1,000
            originalDate: openInvoice!.dueDate,
            simulatedDate: '2026-11-15',
          },
        ],
      },
    );

    expect(validRes.status).toBe(200);
    expect(validRes.body.forecast).toBeDefined();

    expect(validRes.status).toBe(200);
    expect(validRes.body.forecast).toBeDefined();

    // 2. Evaluate action with missing non-existent targetId -> HTTP 400 INVALID_SCENARIO_ACTIONS
    const missingTargetRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [
          {
            targetType: 'CUSTOMER_INVOICE',
            targetId: '00000000-0000-0000-0000-999999999999',
            targetLabel: 'NonExistent',
            actionType: 'ACCELERATE_INFLOW',
            amountPaise: '100000',
            originalDate: '2026-11-20',
            simulatedDate: '2026-11-16',
          },
        ],
      },
    );

    expect(missingTargetRes.status).toBe(400);
    expect(missingTargetRes.body.error?.code).toBe('INVALID_SCENARIO_ACTIONS');
    expect(missingTargetRes.body.error?.message).toContain('not found in current business records');

    // 3. Evaluate action with amount exceeding invoice balance -> HTTP 400 INVALID_SCENARIO_ACTIONS
    const excessiveAmountRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [
          {
            targetType: 'CUSTOMER_INVOICE',
            targetId: openInvoice!.id,
            targetLabel: openInvoice!.invoiceNumber,
            actionType: 'ACCELERATE_INFLOW',
            amountPaise: '999999999999', // Trillions
            originalDate: openInvoice!.dueDate,
            simulatedDate: '2026-11-16',
          },
        ],
      },
    );

    expect(excessiveAmountRes.status).toBe(400);
    expect(excessiveAmountRes.body.error?.code).toBe('INVALID_SCENARIO_ACTIONS');
    expect(excessiveAmountRes.body.error?.message).toContain('exceeds invoice outstanding balance');

    // 4. Evaluate action with invalid simulated date (after original date for acceleration) -> HTTP 400
    const invalidDateRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [
          {
            targetType: 'CUSTOMER_INVOICE',
            targetId: openInvoice!.id,
            targetLabel: openInvoice!.invoiceNumber,
            actionType: 'ACCELERATE_INFLOW',
            amountPaise: '100000',
            originalDate: '2026-11-15',
            simulatedDate: '2026-11-20', // Simulated is after original!
          },
        ],
      },
    );

    expect(invalidDateRes.status).toBe(400);
    expect(invalidDateRes.body.error?.code).toBe('INVALID_SCENARIO_ACTIONS');
    expect(invalidDateRes.body.error?.message).toContain('must be strictly earlier than original due date');
  });
});
