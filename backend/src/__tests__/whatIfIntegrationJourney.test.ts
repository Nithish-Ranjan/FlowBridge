import { describe, expect, it, beforeAll } from 'vitest';
import { createApp } from '../app.js';
import { seedDemoData } from '../db/seed.js';
import { listCustomerInvoices, listSupplierBills } from '../db/repositories/ledgerRepo.js';
import { PassThrough } from 'node:stream';
import type { Express, Request, Response } from 'express';
import {
  parseScenarioIntent,
  type ScenarioActionInput,
  addDays,
} from '@flowbridge/shared';

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

describe('Resolution Autopilot → What-If Simulator Integration Journeys', () => {
  let app: Express;
  let businessId: string;

  beforeAll(async () => {
    const seed = await seedDemoData();
    businessId = seed.businessId;
    app = createApp();
  });

  it('Journey 1: Autopilot recommendation transfer into What-If evaluation', async () => {
    // 1. Get dashboard with autopilot resolution
    const dashRes = await dispatchJson(app, 'GET', `/api/v1/businesses/${businessId}/dashboard?horizonDays=15`);
    expect(dashRes.status).toBe(200);
    const resolution = (dashRes.body as any).resolution;
    expect(resolution).toBeDefined();

    // 2. Select first feasible recommendation if present, or balanced lever
    if (resolution.feasiblePlans.length > 0) {
      const plan = resolution.feasiblePlans[0];
      const transferredActions: ScenarioActionInput[] = plan.actions.map((a: any) => a.scenarioAction);
      expect(transferredActions.length).toBeGreaterThan(0);

      // 3. Evaluate in What-If via backend API
      const evalRes = await dispatchJson(
        app,
        'POST',
        `/api/v1/scenarios/evaluate?businessId=${businessId}`,
        {
          asOfDate: '2026-11-14',
          horizonDays: 15,
          actions: transferredActions,
        },
      );

      expect(evalRes.status).toBe(200);
      expect((evalRes.body as any).forecast).toBeDefined();
      expect((evalRes.body as any).forecast.days.length).toBe(16);
      expect((evalRes.body as any).forecast.breach.lowestBalancePaise).toBe(plan.postActionLowestBalancePaise);
    }
  });

  it('Journey 2: Ask "What if this retailer pays late?" → guides user with disambiguation', async () => {
    const invoices = await listCustomerInvoices(businessId);
    const bills = await listSupplierBills(businessId);

    const parseRes = parseScenarioIntent('What if this retailer pays late?', {
      invoices,
      bills,
      asOfDate: '2026-11-14',
    });

    expect(parseRes.type).toBe('AMBIGUOUS');
    if (parseRes.type === 'AMBIGUOUS') {
      expect(parseRes.category).toBe('DELAY_RETAILER');
      expect(parseRes.candidateInvoices).toBeDefined();
      expect(parseRes.candidateInvoices!.length).toBeGreaterThan(0);

      // User selects candidate invoice and 5 days delay
      const selectedInv = parseRes.candidateInvoices![0];
      const simDate = addDays(selectedInv.dueDate, 5);
      const action: ScenarioActionInput = {
        targetType: 'CUSTOMER_INVOICE',
        targetId: selectedInv.id,
        targetLabel: `${selectedInv.invoiceNumber} Delayed 5D`,
        actionType: 'DELAY_INFLOW',
        amountPaise: selectedInv.outstandingPaise,
        originalDate: selectedInv.dueDate,
        simulatedDate: simDate,
      };

      // Evaluates successfully in What-If
      const evalRes = await dispatchJson(
        app,
        'POST',
        `/api/v1/scenarios/evaluate?businessId=${businessId}`,
        {
          asOfDate: '2026-11-14',
          horizonDays: 15,
          actions: [action],
        },
      );
      expect(evalRes.status).toBe(200);
      expect((evalRes.body as any).forecast).toBeDefined();
    }
  });

  it('Journey 3: Test a supplier payment delay', async () => {
    const bills = await listSupplierBills(businessId);
    const openBill = bills.find((b) => b.status !== 'PAID');
    expect(openBill).toBeDefined();

    const simDate = addDays(openBill!.dueDate, 5);
    const deferAmt = (BigInt(openBill!.outstandingPaise) * 40n) / 100n;
    const action: ScenarioActionInput = {
      targetType: 'SUPPLIER_BILL',
      targetId: openBill!.id,
      targetLabel: `${openBill!.billNumber} Deferred 5D`,
      actionType: 'DEFER_OUTFLOW',
      amountPaise: deferAmt.toString(),
      originalDate: openBill!.dueDate,
      simulatedDate: simDate,
    };

    const evalRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [action],
      },
    );

    expect(evalRes.status).toBe(200);
    expect((evalRes.body as any).forecast).toBeDefined();
    expect((evalRes.body as any).forecast.days.length).toBe(16);
  });

  it('Journey 4: Test a collection drop', async () => {
    const dropAction: ScenarioActionInput = {
      targetType: 'SYNTHETIC_ADJUSTMENT',
      targetId: null,
      targetLabel: '20% Collection Drop',
      actionType: 'DROP_INFLOW_PCT',
      amountPaise: '20',
      originalDate: null,
      simulatedDate: '2026-11-14',
    };

    const evalRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [dropAction],
      },
    );

    if (evalRes.status !== 200) {
      console.log('Journey 3 error body:', JSON.stringify(evalRes.body));
    }

    expect(evalRes.status).toBe(200);
    expect((evalRes.body as any).forecast).toBeDefined();
  });

  it('Journey 6: Simulate an invalid or unavailable record and verify graceful error handling', async () => {
    // Non-existent targetId (valid UUID format but does not exist in workspace)
    const invalidAction: ScenarioActionInput = {
      targetType: 'CUSTOMER_INVOICE',
      targetId: 'a0000000-0000-0000-0000-000000000099',
      targetLabel: 'Non-existent invoice',
      actionType: 'ACCELERATE_INFLOW',
      amountPaise: '500000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-15',
    };

    const evalRes = await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: [invalidAction],
      },
    );

    expect(evalRes.status).toBe(400);
    expect(evalRes.body.error).toBeDefined();
    expect((evalRes.body.error as any).message).toContain('not found');
  });

  it('Journey 7: Verify that actual financial records remain 100% UNCHANGED and UNMUTATED', async () => {
    // 1. Fetch initial records
    const initialInvoices = await listCustomerInvoices(businessId);
    const initialBills = await listSupplierBills(businessId);

    // 2. Run multiple aggressive scenarios (drops, delays, deferrals)
    const testActions: ScenarioActionInput[] = [
      {
        targetType: 'SYNTHETIC_ADJUSTMENT',
        targetId: null,
        targetLabel: '50% Collection Drop',
        actionType: 'DROP_INFLOW_PCT',
        amountPaise: '50',
        originalDate: null,
        simulatedDate: '2026-11-14',
      },
    ];

    await dispatchJson(
      app,
      'POST',
      `/api/v1/scenarios/evaluate?businessId=${businessId}`,
      {
        asOfDate: '2026-11-14',
        horizonDays: 15,
        actions: testActions,
      },
    );

    // 3. Fetch records again after simulation
    const postInvoices = await listCustomerInvoices(businessId);
    const postBills = await listSupplierBills(businessId);

    // Verify lengths match
    expect(postInvoices.length).toBe(initialInvoices.length);
    expect(postBills.length).toBe(initialBills.length);

    // Verify invoice fields and amounts are identical
    for (let i = 0; i < postInvoices.length; i++) {
      expect(postInvoices[i].outstandingPaise).toBe(initialInvoices[i].outstandingPaise);
      expect(postInvoices[i].dueDate).toBe(initialInvoices[i].dueDate);
      expect(postInvoices[i].status).toBe(initialInvoices[i].status);
    }

    // Verify bill fields and amounts are identical
    for (let i = 0; i < postBills.length; i++) {
      expect(postBills[i].outstandingPaise).toBe(initialBills[i].outstandingPaise);
      expect(postBills[i].dueDate).toBe(initialBills[i].dueDate);
      expect(postBills[i].status).toBe(initialBills[i].status);
    }
  });
});
