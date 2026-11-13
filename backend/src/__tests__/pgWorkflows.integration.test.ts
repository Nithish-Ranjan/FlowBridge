import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Express, Request, Response } from 'express';
import { resetEnvCacheForTests } from '../config/env.js';
import { checkDatabaseHealth, closePool, withTransaction } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { createApp } from '../app.js';

let app: Express;
let testBusinessId: string;
let retailerId: string;
let invoiceC3301Id: string;
let invoiceC3307Id: string;
let invoicePartialId: string;
let supplierId: string;

async function callV1(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const raw = body !== undefined ? JSON.stringify(body) : '';
  const req = new PassThrough() as unknown as Request & PassThrough & { _body: boolean };
  Object.assign(req, {
    method,
    url: path,
    originalUrl: path,
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
      json(payload: unknown) {
        resolve({ status: statusCode, data: payload });
        return res;
      },
      send(payload: unknown) {
        const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        resolve({ status: statusCode, data: parsed });
        return res;
      },
      end(chunk?: Buffer | string) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: statusCode, data: text ? JSON.parse(text) : {} });
        return res;
      },
    });
    (app as unknown as (req: Request, res: Response) => void)(req, res);
  });
}

describe('PostgreSQL + /api/v1 End-to-End Integration Workflows', () => {
  beforeAll(async () => {
    resetEnvCacheForTests();
    const health = await checkDatabaseHealth();
    if (!health.ok) {
      throw new Error('PostgreSQL must be running to execute pgWorkflows.integration.test.ts');
    }
    await runMigrations();
    app = createApp({ rateLimitMax: 1000 });

    const suffix = Date.now().toString(36);
    const bizRes = await callV1('POST', '/api/v1/businesses', {
      code: `INT-${suffix}`,
      name: 'Integration Test Distributor',
      openingCashPaise: '8000000', // ₹80,000 Day 0 (2026-11-11)
      openingCashDate: '2026-11-11',
      minimumCashPaise: '0',
      allocationPolicy: 'OLDEST_DUE_FIRST',
    });
    expect(bizRes.status).toBe(201);
    testBusinessId = bizRes.data.business.id;

    // Update approval limits explicitly
    await callV1('PATCH', `/api/v1/business/settings?businessId=${testBusinessId}`, {
      approvalLimits: {
        maxEarlyRequestPct: 100,
        maxEarlyDays: 14,
        defaultMaxSupplierDeferralPct: 40,
        defaultMaxSupplierDeferralDays: 10,
        protectEssentialExpenses: true,
        maxActionsPerPlan: 2,
      },
    });

    const retRes = await callV1('POST', `/api/v1/retailers?businessId=${testBusinessId}`, {
      retailerCode: 'FB-INT-1',
      name: 'Sri Sai Kirana Integration',
      creditTermsDays: 30,
      reliabilityScore: 92,
    });
    retailerId = retRes.data.retailer.id;

    await callV1(
      'POST',
      `/api/v1/retailers/${retailerId}/payment-identifiers?businessId=${testBusinessId}`,
      {
        identifierType: 'UPI_ID',
        rawValue: 'srisai.kirana@okaxis',
        displayLabel: 'Primary UPI',
        verified: true,
      },
    );

    const supRes = await callV1('POST', `/api/v1/suppliers?businessId=${testBusinessId}`, {
      supplierCode: 'SUP-INT',
      name: 'Bharat Oils Supplier',
      maxDeferralDays: 10,
      maxDeferralPct: 40,
      isCritical: false,
    });
    supplierId = supRes.data.supplier.id;

    // Blueprint invoices & outflows
    const inv1 = await callV1('POST', `/api/v1/invoices?businessId=${testBusinessId}`, {
      retailerId,
      invoiceNumber: 'C-3301',
      invoiceDate: '2026-10-25',
      dueDate: '2026-11-25', // Day 14
      totalAmountPaise: '2000000', // ₹20,000
      evidenceStatus: 'CONFIRMED_PROMISE',
    });
    invoiceC3301Id = inv1.data.invoice.id;

    const inv2 = await callV1('POST', `/api/v1/invoices?businessId=${testBusinessId}`, {
      retailerId,
      invoiceNumber: 'C-3307',
      invoiceDate: '2026-10-21',
      dueDate: '2026-11-21', // Day 10
      totalAmountPaise: '6000000', // ₹60,000
      evidenceStatus: 'UNCONFIRMED',
    });
    invoiceC3307Id = inv2.data.invoice.id;

    const inv3 = await callV1('POST', `/api/v1/invoices?businessId=${testBusinessId}`, {
      retailerId,
      invoiceNumber: 'C-PARTIAL-10K',
      invoiceDate: '2026-10-15',
      dueDate: '2026-12-10', // Outside 15d forecast window so Day 5 stays clean
      totalAmountPaise: '1000000', // ₹10,000
      evidenceStatus: 'UNCONFIRMED',
    });
    invoicePartialId = inv3.data.invoice.id;

    await callV1('POST', `/api/v1/supplier-bills?businessId=${testBusinessId}`, {
      supplierId,
      billNumber: 'S-2041',
      issueDate: '2026-10-25',
      dueDate: '2026-11-16', // Day 5
      totalAmountPaise: '9500000', // ₹95,000
      priorityTier: 'FLEXIBLE',
    });

    await callV1('POST', `/api/v1/expenses?businessId=${testBusinessId}`, {
      expenseCode: 'B-0007',
      category: 'PAYROLL',
      description: 'Staff Payroll',
      dueDate: '2026-11-16', // Day 5
      amountPaise: '1500000', // ₹15,000
      priorityTier: 'ESSENTIAL',
      isProtected: true,
    });
  });

  afterAll(async () => {
    if (testBusinessId) {
      await withTransaction(async (client) => {
        await client.query(
          'ALTER TABLE payment_allocations DISABLE TRIGGER trg_reject_payment_allocation_mutation',
        );
        await client.query(
          'ALTER TABLE payment_transactions DISABLE TRIGGER trg_guard_payment_transaction_immutability',
        );
        await client.query("DELETE FROM payment_allocations WHERE business_id = $1 AND entry_type = 'REVERSAL'", [testBusinessId]);
        await client.query('DELETE FROM payment_allocations WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM commitments WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM retailer_credit_ledger WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM payment_transactions WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM customer_invoices WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM supplier_bills WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM operating_expenses WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM suppliers WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM retailers WHERE business_id = $1', [testBusinessId]);
        await client.query('DELETE FROM businesses WHERE id = $1', [testBusinessId]);
        await client.query(
          'ALTER TABLE payment_transactions ENABLE TRIGGER trg_guard_payment_transaction_immutability',
        );
        await client.query(
          'ALTER TABLE payment_allocations ENABLE TRIGGER trg_reject_payment_allocation_mutation',
        );
      });
    }
    await closePool();
  });

  it('computes Day-5 breach (-₹30,000) and Day-10 receipt recovery (+₹30k->+₹50k)', async () => {
    const res = await callV1(
      'GET',
      `/api/v1/forecast?businessId=${testBusinessId}&from=2026-11-11&to=2026-11-26`,
    );
    expect(res.status).toBe(200);
    expect(res.data.forecast.breach.firstBreachDate).toBe('2026-11-16');
    expect(res.data.forecast.breach.firstBreachClosingPaise).toBe('-3000000');
    expect(res.data.forecast.days[10].closingBalancePaise).toBe('3000000');
    expect(res.data.forecast.days[15].closingBalancePaise).toBe('5000000');
  });

  it('finds feasible Plan A (+₹15,000 on Day 5) and keeps baseline scenario isolated', async () => {
    const res = await callV1('POST', `/api/v1/resolution/run?businessId=${testBusinessId}`, {
      asOfDate: '2026-11-11',
      horizonDays: 15,
    });
    expect(res.status).toBe(200);
    expect(['FEASIBLE_FOUND', 'FEASIBLE_PLANS_FOUND']).toContain(res.data.resolution.status);
    expect(res.data.resolution.totalCombinationsEvaluated).toBe(30);
    const planA = res.data.resolution.feasiblePlans[0];
    expect(BigInt(planA.postActionLowestBalancePaise)).toBeGreaterThanOrEqual(0n);

    // Save a shockwave scenario and confirm baseline forecast does NOT change
    const scenRes = await callV1('POST', `/api/v1/scenarios?businessId=${testBusinessId}`, {
      name: 'Shockwave Delay Test',
      scenarioKind: 'SHOCKWAVE_WHAT_IF',
      asOfDate: '2026-11-11',
      horizonDays: 15,
      actions: [
        {
          targetType: 'CUSTOMER_INVOICE',
          targetId: invoiceC3307Id,
          targetLabel: 'C-3307 +3d',
          actionType: 'DELAY_INFLOW',
          amountPaise: '6000000',
          originalDate: '2026-11-21',
          simulatedDate: '2026-11-24',
        },
      ],
    });
    expect(scenRes.status).toBe(201);

    const baselineAfter = await callV1(
      'GET',
      `/api/v1/forecast?businessId=${testBusinessId}&from=2026-11-11&to=2026-11-26`,
    );
    expect(baselineAfter.data.forecast.days[10].closingBalancePaise).toBe('3000000');
  });

  it('handles duplicate CSV import idempotently, ambiguous match queue, partial ₹10k->₹9k, overpayment, and reversal', async () => {
    const csvText = [
      'direction,payment_method,external_transaction_reference,explicit_invoice_reference,payer_identifier_raw,payer_display_name,narration,amount_paise,transaction_timestamp,value_date',
      'INFLOW,UPI,UTR-DUP-1,C-PARTIAL-10K,srisai.kirana@okaxis,Sri Sai Kirana,Partial 1000,100000,2026-11-11T11:00:00Z,2026-11-11',
      'INFLOW,UPI,UTR-DUP-1,C-PARTIAL-10K,srisai.kirana@okaxis,Sri Sai Kirana,Partial 1000,100000,2026-11-11T11:00:00Z,2026-11-11',
      'INFLOW,BANK_TRANSFER,UTR-AMB-1,,unknown-acct-9999,Sri Sai Similar Name Only,Bank transfer without ref,50000,2026-11-11T12:00:00Z,2026-11-11',
    ].join('\n');

    const impRes = await callV1('POST', `/api/v1/imports/bank-transactions?businessId=${testBusinessId}`, {
      filename: 'test.csv',
      csvText,
    });
    expect(impRes.status).toBe(201);
    expect(impRes.data.insertedRows).toBe(2);
    expect(impRes.data.duplicateRows).toBe(1);

    // Check ambiguous queue does NOT auto-match by name similarity
    const queueRes = await callV1('GET', `/api/v1/payments/match-queue?businessId=${testBusinessId}`);
    expect(queueRes.status).toBe(200);
    expect(queueRes.data.queue.length).toBeGreaterThanOrEqual(1);
    const unmatchedTx = queueRes.data.queue[0];

    // Confirm manual match on ambiguous tx
    const resolveRes = await callV1(
      'POST',
      `/api/v1/payments/${unmatchedTx.id}/resolve-match?businessId=${testBusinessId}`,
      { retailerId, note: 'Confirmed by distributor' },
    );
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.data.transaction.matchStatus).toBe('MATCHED');

    // Preview & confirm ₹1,000 partial allocation against ₹10,000 invoice -> ₹9,000 outstanding
    const partialTx = impRes.data.insertedTransactions[0];
    const previewRes = await callV1(
      'GET',
      `/api/v1/payments/${partialTx.id}/allocation-preview?businessId=${testBusinessId}`,
    );
    expect(previewRes.status).toBe(200);
    expect(previewRes.data.preview.lines[0].invoiceId).toBe(invoicePartialId);
    expect(previewRes.data.preview.lines[0].postAllocationOutstandingPaise).toBe('900000');

    const allocRes = await callV1(
      'POST',
      `/api/v1/payments/${partialTx.id}/allocate?businessId=${testBusinessId}`,
      {
        allocations: [
          {
            invoiceId: invoicePartialId,
            amountPaise: '100000',
            allocationMethod: 'EXPLICIT_INVOICE',
          },
        ],
      },
    );
    expect(allocRes.status).toBe(200);

    const invAfterPartial = await callV1(
      'GET',
      `/api/v1/invoices/${invoicePartialId}?businessId=${testBusinessId}`,
    );
    expect(invAfterPartial.data.invoice.outstandingPaise).toBe('900000');

    // Verify no double counting: forecast total day inflows shouldn't add ₹1,000 twice
    const fAfter = await callV1(
      'GET',
      `/api/v1/forecast?businessId=${testBusinessId}&from=2026-11-11&to=2026-11-26`,
    );
    expect(fAfter.data.forecast.days[5].closingBalancePaise).toBe('-2900000'); // -30k + 1k actual on Day 0

    // Reverse ₹1,000 payment -> restores ₹10,000 outstanding non-destructively
    const revRes = await callV1(
      'POST',
      `/api/v1/payments/${partialTx.id}/reverse?businessId=${testBusinessId}`,
      { reason: 'Integration reversal test' },
    );
    expect(revRes.status).toBe(200);

    const invRestored = await callV1(
      'GET',
      `/api/v1/invoices/${invoicePartialId}?businessId=${testBusinessId}`,
    );
    expect(invRestored.data.invoice.outstandingPaise).toBe('1000000');
  });

  it('tracks missed payment radar and triggers deterministic replan without false-agreeing proposals', async () => {
    const propRes = await callV1('POST', `/api/v1/commitments?businessId=${testBusinessId}`, {
      counterpartyType: 'RETAILER',
      retailerId,
      customerInvoiceId: invoiceC3301Id,
      actionType: 'EARLY_RECEIPT',
      proposedAmountPaise: '2000000',
      proposedDate: '2026-11-15',
    });
    expect(propRes.status).toBe(201);
    expect(propRes.data.commitment.status).toBe('PROPOSED');
    expect(propRes.data.commitment.humanReplyRecorded).toBe(false);

    const agreeRes = await callV1(
      'PATCH',
      `/api/v1/commitments/${propRes.data.commitment.id}/status?businessId=${testBusinessId}`,
      {
        status: 'AGREED',
        humanReplyBy: 'Ramesh',
        humanReplyChannel: 'WHATSAPP',
        agreedAmountPaise: '2000000',
        agreedDate: '2026-11-15',
      },
    );
    expect(agreeRes.status).toBe(200);
    expect(agreeRes.data.commitment.status).toBe('AGREED');

    // Simulate missed delay on C-3301 via promise-failure radar
    const radarRes = await callV1(
      'POST',
      `/api/v1/risk/promise-failure-radar?businessId=${testBusinessId}`,
      {
        horizonDays: 16,
        simulatedDelays: [{ invoiceId: invoiceC3301Id, delayDays: 3 }],
      },
    );
    expect(radarRes.status).toBe(200);
    expect(radarRes.data.verification.radar.alerts.length).toBeGreaterThan(0);
    expect(radarRes.data.verification.radar.replanResult).not.toBeNull();
  });
});

