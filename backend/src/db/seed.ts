import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  computeCashForecast,
  maskPaymentIdentifier,
  type CustomerInvoiceDTO,
  type MatchEvidence,
  type OperatingExpenseDTO,
  type SupplierBillDTO,
} from '@flowbridge/shared';
import { getEnv } from '../config/env.js';
import { computeIdentifierHmac, computeTransactionFingerprint } from '../utils/crypto.js';
import { closePool, withTransaction } from './pool.js';
import { runMigrations } from './migrate.js';
import { ensureDemoUser } from '../services/authService.js';

const __filename = fileURLToPath(import.meta.url);

export const DEMO_BUSINESS_CODE = 'DEMO-DIST-01';
export const DEMO_DAY0 = '2026-11-11';

export async function seedDemoData(): Promise<{ businessId: string; seeded: boolean }> {
  const env = getEnv();
  await runMigrations();

  const result = await withTransaction(async (client) => {
    const existingBiz = await client.query<{ id: string }>(
      'SELECT id FROM businesses WHERE code = $1',
      [DEMO_BUSINESS_CODE],
    );

    if (existingBiz.rows.length > 0) {
      await ensureDemoUser(existingBiz.rows[0].id);
      return { businessId: existingBiz.rows[0].id, seeded: false };
    }

    const day5 = addDays(DEMO_DAY0, 5);
    const day10 = addDays(DEMO_DAY0, 10);
    const day14 = addDays(DEMO_DAY0, 14);
    const day25 = addDays(DEMO_DAY0, 25);

    // 1. Business setup: Opening cash ₹80,000 (8,000,000 paise) on Day 0
    const bizRes = await client.query<{ id: string }>(
      `INSERT INTO businesses (
        code, name, currency, timezone, opening_cash_paise, opening_cash_date,
        minimum_cash_paise, allocation_policy
      ) VALUES ($1, $2, 'INR', 'Asia/Kolkata', $3, $4, $5, 'OLDEST_DUE_FIRST')
      RETURNING id`,
      [
        DEMO_BUSINESS_CODE,
        'Deccan FMCG Distributors (Synthetic Demo)',
        '8000000',
        DEMO_DAY0,
        '0',
      ],
    );
    const businessId = bizRes.rows[0].id;

    // 2. Retailers: Customer A, Customer B, and FB-R001
    const retARes = await client.query<{ id: string }>(
      `INSERT INTO retailers (
        business_id, retailer_code, name, contact_name, phone_masked, credit_terms_days, reliability_score, notes
      ) VALUES ($1, 'RET-CUST-A', 'Customer A — Anand Supermart', 'Ramesh Anand', '+91-98XXXXXX11', 14, 92,
        'Synthetic Customer A for illustrative early-receipt resolution option (₹20,000)')
      RETURNING id`,
      [businessId],
    );
    const retAId = retARes.rows[0].id;

    const retBRes = await client.query<{ id: string }>(
      `INSERT INTO retailers (
        business_id, retailer_code, name, contact_name, phone_masked, credit_terms_days, reliability_score, notes
      ) VALUES ($1, 'RET-CUST-B', 'Customer B — Bharat Kirana Mart', 'Suresh Kulkarni', '+91-98XXXXXX22', 10, 74,
        'Synthetic Customer B for Day 10 ₹60,000 expected unconfirmed receivable')
      RETURNING id`,
      [businessId],
    );
    const retBId = retBRes.rows[0].id;

    const fbR001Res = await client.query<{ id: string }>(
      `INSERT INTO retailers (
        business_id, retailer_code, name, contact_name, phone_masked, credit_terms_days, reliability_score, notes
      ) VALUES ($1, 'FB-R001', 'Metro Kirana & General Store (Payment ID Demo)', 'Kavita Deshmukh', '+91-98XXXXXX01', 30, 88,
        'Synthetic Retailer Payment Identification Demo — independent from original Day-5 cash gap example')
      RETURNING id`,
      [businessId],
    );
    const fbR001Id = fbR001Res.rows[0].id;

    // 3. Verified payment identifiers (masked display + keyed HMAC only)
    const identifierSpecs = [
      {
        retailerId: retAId,
        type: 'UPI_ID' as const,
        raw: 'anand.supermart@okhdfcbank',
        label: 'Anand Supermart Verified UPI',
      },
      {
        retailerId: retBId,
        type: 'UPI_ID' as const,
        raw: 'bharat.mart@okicici',
        label: 'Bharat Kirana Verified UPI',
      },
      {
        retailerId: fbR001Id,
        type: 'UPI_ID' as const,
        raw: 'fb-r001.demo@okaxis',
        label: 'FB-R001 Demo Verified UPI',
      },
      {
        retailerId: fbR001Id,
        type: 'BANK_ACCOUNT' as const,
        raw: 'HDFC0001042:7788994821',
        label: 'FB-R001 Demo HDFC Account',
      },
    ];

    for (const spec of identifierSpecs) {
      const fp = computeIdentifierHmac(spec.type, spec.raw, env.IDENTIFIER_HMAC_SECRET);
      const masked = maskPaymentIdentifier(spec.type, spec.raw);
      await client.query(
        `INSERT INTO retailer_payment_identifiers (
          business_id, retailer_id, identifier_type, normalized_fingerprint, masked_value, display_label, verified_at, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, now(), true)`,
        [businessId, spec.retailerId, spec.type, fp, masked, spec.label],
      );
    }

    // 4. Supplier A
    const supARes = await client.query<{ id: string }>(
      `INSERT INTO suppliers (
        business_id, supplier_code, name, contact_name, phone_masked, max_deferral_days, max_deferral_pct, is_critical
      ) VALUES ($1, 'SUP-A', 'Supplier A — Shree Ganesh Traders', 'Mahesh Gupta', '+91-97XXXXXX55', 10, 40, false)
      RETURNING id`,
      [businessId],
    );
    const supAId = supARes.rows[0].id;

    // 5. Customer Invoices: C-3307 (₹60k Day 10 unconfirmed), C-3301 (₹20k Day 14 early-receipt candidate), DEMO-R001-INV1 (₹10k Day 25 independent demo)
    const invC3307Res = await client.query<{ id: string }>(
      `INSERT INTO customer_invoices (
        business_id, retailer_id, invoice_number, invoice_date, due_date, total_amount_paise,
        status, evidence_status, external_reference, record_origin, notes
      ) VALUES ($1, $2, 'C-3307', '2026-11-01', $3, '6000000', 'OPEN', 'UNCONFIRMED', 'C-3307', 'SEEDED_DEMO',
        'Synthetic blueprint receivable: ₹60,000 expected Day 10, initially unconfirmed')
      RETURNING id`,
      [businessId, retBId, day10],
    );

    const invC3301Res = await client.query<{ id: string }>(
      `INSERT INTO customer_invoices (
        business_id, retailer_id, invoice_number, invoice_date, due_date, total_amount_paise,
        status, evidence_status, external_reference, record_origin, notes
      ) VALUES ($1, $2, 'C-3301', '2026-11-01', $3, '2000000', 'OPEN', 'CONFIRMED_PROMISE', 'C-3301', 'SEEDED_DEMO',
        'Illustrative early-receipt candidate (₹20,000; request early payment by Day 4 in Plan A)')
      RETURNING id`,
      [businessId, retAId, day14],
    );

    await client.query(
      `INSERT INTO customer_invoices (
        business_id, retailer_id, invoice_number, invoice_date, due_date, total_amount_paise,
        status, evidence_status, external_reference, record_origin, notes
      ) VALUES ($1, $2, 'DEMO-R001-INV1', '2026-11-02', $3, '1000000', 'OPEN', 'CONFIRMED_PROMISE', 'DEMO-R001-INV1', 'SEEDED_DEMO',
        'Synthetic Retailer Payment Identification Demo (₹10,000 open, independent from Day-5 cash gap worked example)')`,
      [businessId, fbR001Id, day25],
    );

    // 6. Supplier Bill S-2041 (₹95,000 due Day 5)
    const billS2041Res = await client.query<{ id: string }>(
      `INSERT INTO supplier_bills (
        business_id, supplier_id, bill_number, issue_date, due_date, total_amount_paise,
        status, evidence_status, priority_tier, record_origin, notes
      ) VALUES ($1, $2, 'S-2041', '2026-11-01', $3, '9500000', 'OPEN', 'CONFIRMED', 'FLEXIBLE', 'SEEDED_DEMO',
        'Synthetic blueprint supplier bill: ₹95,000 due Day 5')
      RETURNING id`,
      [businessId, supAId, day5],
    );

    // 7. Operating Expense B-0007 (₹15,000 due Day 5)
    const expB0007Res = await client.query<{ id: string }>(
      `INSERT INTO operating_expenses (
        business_id, expense_code, category, description, due_date, amount_paise,
        status, priority_tier, is_protected, record_origin
      ) VALUES ($1, 'B-0007', 'UTILITIES_AND_LOGISTICS', 'Warehouse Power & Fleet Dispatch', $2, '1500000',
        'SCHEDULED', 'ESSENTIAL', true, 'SEEDED_DEMO')
      RETURNING id`,
      [businessId, day5],
    );

    // 8. Demo Bank Import Batch & ₹1,000 incoming UPI payment for FB-R001 (awaiting human allocation confirmation)
    const batchRes = await client.query<{ id: string }>(
      `INSERT INTO bank_import_batches (
        business_id, source_type, filename, status, total_rows, inserted_rows, duplicate_rows, error_rows
      ) VALUES ($1, 'SEEDED_DEMO', 'seed_demo_upi_fb_r001.json', 'COMPLETED', 1, 1, 0, 0)
      RETURNING id`,
      [businessId],
    );
    const batchId = batchRes.rows[0].id;

    const fbUpiRaw = 'fb-r001.demo@okaxis';
    const fbUpiHmac = computeIdentifierHmac('UPI_ID', fbUpiRaw, env.IDENTIFIER_HMAC_SECRET);
    const fbUpiMasked = maskPaymentIdentifier('UPI_ID', fbUpiRaw);
    const demoValueDate = addDays(DEMO_DAY0, -1);
    const demoTxTs = `${demoValueDate}T14:30:00.000Z`;
    const demoTxFp = computeTransactionFingerprint(
      {
        direction: 'INFLOW',
        paymentMethod: 'UPI',
        externalTransactionReference: 'UTR-DEMO-FBR001-1000',
        amountPaise: '100000',
        valueDate: demoValueDate,
        transactionTimestamp: demoTxTs,
        payerIdentifierFingerprint: fbUpiHmac,
        narration: 'UPI/UTR-DEMO-FBR001-1000/Metro Kirana partial payment',
      },
      env.TX_FINGERPRINT_SECRET,
    );

    const demoEvidence: MatchEvidence = {
      decision: 'MATCHED',
      rule: 'EXACT_VERIFIED_UPI_HMAC',
      explanation: `Exact verified UPI HMAC match (${fbUpiMasked}) to retailer FB-R001. Ready for allocation preview & confirmation (₹1,000 -> DEMO-R001-INV1 reducing ₹10,000 to ₹9,000).`,
      candidates: [
        {
          retailerId: fbR001Id,
          retailerCode: 'FB-R001',
          retailerName: 'Metro Kirana & General Store (Payment ID Demo)',
          reason: 'EXACT_VERIFIED_UPI_HMAC',
          matchedTokenMasked: fbUpiMasked,
        },
      ],
    };

    const txRes = await client.query<{ id: string }>(
      `INSERT INTO payment_transactions (
        business_id, import_batch_id, direction, payment_method, external_transaction_reference,
        explicit_invoice_reference, payer_identifier_fingerprint, payer_identifier_masked,
        payer_display_name, narration, amount_paise, transaction_timestamp, value_date,
        transaction_fingerprint, match_status, matched_retailer_id, match_evidence_json,
        allocation_status, verification_status, source_type
      ) VALUES (
        $1, $2, 'INFLOW', 'UPI', 'UTR-DEMO-FBR001-1000',
        NULL, $3, $4,
        'Metro Kirana UPI', 'UPI/UTR-DEMO-FBR001-1000/Partial payment demo (synthetic)', '100000', $5, $6,
        $7, 'MATCHED', $8, $9::jsonb,
        'UNAPPLIED', 'PENDING_REVIEW', 'SEEDED_DEMO'
      )
      RETURNING id`,
      [
        businessId,
        batchId,
        fbUpiHmac,
        fbUpiMasked,
        demoTxTs,
        demoValueDate,
        demoTxFp,
        fbR001Id,
        JSON.stringify(demoEvidence),
      ],
    );

    // 9. Generate and persist initial baseline forecast snapshot for Day 0..15 (blueprint scope)
    const blueprintInvoices: CustomerInvoiceDTO[] = [
      {
        id: invC3307Res.rows[0].id,
        businessId,
        retailerId: retBId,
        retailerCode: 'RET-CUST-B',
        retailerName: 'Customer B — Bharat Kirana Mart',
        invoiceNumber: 'C-3307',
        invoiceDate: '2026-11-01',
        dueDate: day10,
        totalAmountPaise: '6000000',
        paidAmountPaise: '0',
        outstandingPaise: '6000000',
        status: 'OPEN',
        evidenceStatus: 'UNCONFIRMED',
        externalReference: 'C-3307',
        recordOrigin: 'SEEDED_DEMO',
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: invC3301Res.rows[0].id,
        businessId,
        retailerId: retAId,
        retailerCode: 'RET-CUST-A',
        retailerName: 'Customer A — Anand Supermart',
        invoiceNumber: 'C-3301',
        invoiceDate: '2026-11-01',
        dueDate: day14,
        totalAmountPaise: '2000000',
        paidAmountPaise: '0',
        outstandingPaise: '2000000',
        status: 'OPEN',
        evidenceStatus: 'CONFIRMED_PROMISE',
        externalReference: 'C-3301',
        recordOrigin: 'SEEDED_DEMO',
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const blueprintBills: SupplierBillDTO[] = [
      {
        id: billS2041Res.rows[0].id,
        businessId,
        supplierId: supAId,
        supplierCode: 'SUP-A',
        supplierName: 'Supplier A — Shree Ganesh Traders',
        billNumber: 'S-2041',
        issueDate: '2026-11-01',
        dueDate: day5,
        totalAmountPaise: '9500000',
        paidAmountPaise: '0',
        outstandingPaise: '9500000',
        status: 'OPEN',
        evidenceStatus: 'CONFIRMED',
        priorityTier: 'FLEXIBLE',
        recordOrigin: 'SEEDED_DEMO',
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const blueprintExpenses: OperatingExpenseDTO[] = [
      {
        id: expB0007Res.rows[0].id,
        businessId,
        expenseCode: 'B-0007',
        category: 'UTILITIES_AND_LOGISTICS',
        description: 'Warehouse Power & Fleet Dispatch',
        dueDate: day5,
        amountPaise: '1500000',
        paidAmountPaise: '0',
        outstandingPaise: '1500000',
        status: 'SCHEDULED',
        priorityTier: 'ESSENTIAL',
        isProtected: true,
        recordOrigin: 'SEEDED_DEMO',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const baseline = computeCashForecast({
      businessId,
      asOfDate: DEMO_DAY0,
      horizonDays: 15,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices: blueprintInvoices,
      bills: blueprintBills,
      expenses: blueprintExpenses,
    });

    await client.query(
      `INSERT INTO forecast_snapshots (
        business_id, scenario_id, snapshot_label, data_classification, as_of_date, horizon_days,
        first_breach_date, minimum_balance_paise, opening_cash_paise, series_json, diagnostics_json, input_fingerprint
      ) VALUES ($1, NULL, 'Initial Blueprint Baseline (Day 0 - Day 15)', 'ACTUAL_PLUS_EXPECTED', $2, 15, $3, $4, $5, $6::jsonb, $7::jsonb, 'seed-baseline-v1')`,
      [
        businessId,
        DEMO_DAY0,
        baseline.breach.firstBreachDate,
        baseline.breach.lowestBalancePaise,
        baseline.openingCashPaise,
        JSON.stringify(baseline.days),
        JSON.stringify({
          breach: baseline.breach,
          chasePriorities: baseline.chasePriorities,
          trustCounters: baseline.trustCounters,
        }),
      ],
    );

    await client.query(
      `INSERT INTO audit_events (business_id, event_type, entity_type, entity_id, actor, payload_json)
       VALUES ($1, 'DEMO_SEED_INITIALIZED', 'payment_transactions', $2, 'SEED_SCRIPT', $3::jsonb)`,
      [
        businessId,
        txRes.rows[0].id,
        JSON.stringify({
          businessCode: DEMO_BUSINESS_CODE,
          day0: DEMO_DAY0,
          demoPaymentId: txRes.rows[0].id,
        }),
      ],
    );

    await ensureDemoUser(businessId);
    return { businessId, seeded: true };
  });

  return result;
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isCli) {
  seedDemoData()
    .then((res) => {
      console.log(
        `[db:seed] Business ${res.businessId}: ${res.seeded ? 'seeded fresh demo records' : 'already seeded (idempotent skip)'}.`,
      );
      return closePool();
    })
    .catch(async (err) => {
      console.error('[db:seed] Error:', err);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}

