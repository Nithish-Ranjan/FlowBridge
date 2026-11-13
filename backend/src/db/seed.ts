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
export const DEMO_DAY0 = '2026-11-13';

export async function seedDemoData(force = false): Promise<{ businessId: string; seeded: boolean }> {
  const env = getEnv();
  await runMigrations();

  const result = await withTransaction(async (client) => {
    const existingBiz = await client.query<{ id: string }>(
      'SELECT id FROM businesses WHERE code = $1',
      [DEMO_BUSINESS_CODE],
    );

    if (existingBiz.rows.length > 0 && !force) {
      await ensureDemoUser(existingBiz.rows[0].id);
      return { businessId: existingBiz.rows[0].id, seeded: false };
    }

    if (existingBiz.rows.length > 0 && force) {
      await client.query('DELETE FROM businesses WHERE code = $1', [DEMO_BUSINESS_CODE]);
    }

    // 1. Business Setup: Sharma Distribution Hub
    // Opening Cash: ₹60,000 (6,000,000 paise)
    // Minimum Cash Threshold: ₹50,000 (5,000,000 paise)
    const bizRes = await client.query<{ id: string }>(
      `INSERT INTO businesses (
        code, name, currency, timezone, opening_cash_paise, opening_cash_date,
        minimum_cash_paise, allocation_policy, owner_name, contact_phone, whatsapp_phone,
        business_type, warehouse_address
      ) VALUES (
        $1, $2, 'INR', 'Asia/Kolkata', $3, $4, $5, 'OLDEST_DUE_FIRST',
        'Rajesh Sharma', '+91 98765 43210', '+91 98765 43210',
        'FMCG & Consumer Goods Wholesale', 'Plot 42, APMC Market Yard, Sector 19, Vashi, Navi Mumbai, Maharashtra 400705'
      )
      RETURNING id`,
      [
        DEMO_BUSINESS_CODE,
        'Sharma Distribution Hub (FMCG Wholesale)',
        '6000000',
        DEMO_DAY0,
        '5000000',
      ],
    );
    const businessId = bizRes.rows[0].id;

    // 2. Retailers Directory (12 realistic retailers with diverse risk profiles + 1 payment matching demo)
    const retailerSeedData = [
      {
        code: 'RET-01',
        name: 'Shree Balaji Mart',
        contact: 'Manoj Agarwal',
        phone: '+91 98201 11223',
        email: 'balaji.mart@example.com',
        terms: 15,
        score: 65,
        notes: 'Payment delayed by 14 days; missed previous commitment. Elevated collection risk.',
        upi: 'balaji.mart@okhdfcbank',
      },
      {
        code: 'RET-02',
        name: 'Krishna Superstore',
        contact: 'Suresh Patel',
        phone: '+91 98334 22334',
        email: 'krishna.store@example.com',
        terms: 21,
        score: 75,
        notes: 'Partial payment history; promised balance payment of ₹30,000 on 17-Nov.',
        upi: 'krishna.store@okicici',
      },
      {
        code: 'RET-03',
        name: 'Om Sai Provision Store',
        contact: 'Ramesh Gupta',
        phone: '+91 98112 33445',
        email: 'omsai.provisions@example.com',
        terms: 15,
        score: 70,
        notes: '2 invoices overdue; high credit limit utilization.',
        upi: 'omsai.provisions@okaxis',
      },
      {
        code: 'RET-04',
        name: 'Laxmi General Trading',
        contact: 'Vinod Shah',
        phone: '+91 98450 44556',
        email: 'laxmi.trading@example.com',
        terms: 30,
        score: 95,
        notes: 'Consistent on-time payer; excellent track record and high turnover.',
        upi: 'laxmi.trading@oksbi',
      },
      {
        code: 'RET-05',
        name: 'Mahadev Retail Traders',
        contact: 'Kailash Meena',
        phone: '+91 98760 55667',
        email: 'mahadev.retail@example.com',
        terms: 15,
        score: 90,
        notes: 'Regular weekly settle-ups; confirmed prompt settlement on 16-Nov.',
        upi: 'mahadev.retail@okicici',
      },
      {
        code: 'RET-06',
        name: 'Ganpati Kirana Stores',
        contact: 'Dinesh Joshi',
        phone: '+91 98220 66778',
        email: 'ganpati.kirana@example.com',
        terms: 20,
        score: 80,
        notes: 'Seasonal slowdown in confectionary orders; steady staples turnover.',
        upi: 'ganpati.kirana@okhdfcbank',
      },
      {
        code: 'RET-07',
        name: 'Venkateshwara Hyper',
        contact: 'Prasad Rao',
        phone: '+91 98490 77889',
        email: 'venkateshwara.hyper@example.com',
        terms: 30,
        score: 92,
        notes: 'Large organized retail volume, 30-day corporate terms.',
        upi: 'venkateshwara@okaxis',
      },
      {
        code: 'RET-08',
        name: 'Bharat Wholesalers & Retail',
        contact: 'Sunil Kumar',
        phone: '+91 98100 88990',
        email: 'bharat.wholesalers@example.com',
        terms: 15,
        score: 88,
        notes: 'Prompt NEFT payer; high credit discipline.',
        upi: 'bharat.wholesalers@okicici',
      },
      {
        code: 'RET-09',
        name: 'City Bazaar Supermarket',
        contact: 'Pooja Verma',
        phone: '+91 98300 99001',
        email: 'citybazaar@example.com',
        terms: 21,
        score: 82,
        notes: 'Occasional payment splits over two banking cycles.',
        upi: 'citybazaar@okhdfcbank',
      },
      {
        code: 'RET-10',
        name: 'Ambaji Departmental',
        contact: 'Chetan Trivedi',
        phone: '+91 98250 12345',
        email: 'ambaji.dept@example.com',
        terms: 15,
        score: 90,
        notes: 'Reliable weekly settlements via UPI.',
        upi: 'ambaji.dept@oksbi',
      },
      {
        code: 'RET-11',
        name: 'Sunrise Express Mart',
        contact: 'Deepak Mishra',
        phone: '+91 98670 23456',
        email: 'sunrise.express@example.com',
        terms: 21,
        score: 85,
        notes: 'Good turnover, automated UPI payments.',
        upi: 'sunrise.express@okaxis',
      },
      {
        code: 'RET-12',
        name: 'Vijay Trading Co',
        contact: 'Vijay Kothari',
        phone: '+91 98920 34567',
        email: 'vijay.trading@example.com',
        terms: 15,
        score: 45,
        notes: 'Multiple bounced cheques in past 60 days, strictly monitor. Critical risk.',
        upi: 'vijay.trading@okhdfcbank',
      },
      {
        code: 'FB-R001',
        name: 'Metro Kirana & General Store (Payment ID Demo)',
        contact: 'Kavita Deshmukh',
        phone: '+91 98765 00001',
        email: 'metro.kirana@example.com',
        terms: 30,
        score: 88,
        notes: 'Synthetic Retailer Payment Identification Demo with verified UPI & Bank identifiers.',
        upi: 'fb-r001.demo@okaxis',
      },
    ];

    const retailerMap = new Map<string, string>();

    for (const r of retailerSeedData) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO retailers (
          business_id, retailer_code, name, contact_name, phone_masked, contact_phone, email,
          credit_terms_days, reliability_score, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [businessId, r.code, r.name, r.contact, r.phone, r.phone, r.email, r.terms, r.score, r.notes],
      );
      const rId = res.rows[0].id;
      retailerMap.set(r.code, rId);

      // Register Verified Payment Identifier
      if (r.upi) {
        const fp = computeIdentifierHmac('UPI_ID', r.upi, env.IDENTIFIER_HMAC_SECRET);
        const masked = maskPaymentIdentifier('UPI_ID', r.upi);
        await client.query(
          `INSERT INTO retailer_payment_identifiers (
            business_id, retailer_id, identifier_type, normalized_fingerprint, masked_value, display_label, verified_at, is_active
          ) VALUES ($1, $2, 'UPI_ID', $3, $4, $5, now(), true)`,
          [businessId, rId, fp, masked, `${r.name} Verified UPI`],
        );
      }
    }

    // Additional Bank Account identifier for FB-R001
    const fbR001Id = retailerMap.get('FB-R001')!;
    const bankRaw = 'HDFC0001042:7788994821';
    const bankFp = computeIdentifierHmac('BANK_ACCOUNT', bankRaw, env.IDENTIFIER_HMAC_SECRET);
    const bankMasked = maskPaymentIdentifier('BANK_ACCOUNT', bankRaw);
    await client.query(
      `INSERT INTO retailer_payment_identifiers (
        business_id, retailer_id, identifier_type, normalized_fingerprint, masked_value, display_label, verified_at, is_active
      ) VALUES ($1, $2, 'BANK_ACCOUNT', $3, $4, 'Metro Kirana HDFC Operating Account', now(), true)`,
      [businessId, fbR001Id, bankFp, bankMasked],
    );

    // 3. Suppliers (Major FMCG Manufacturers & National Consignors)
    const supplierSeedData = [
      {
        code: 'SUP-01',
        name: 'Apex Consumer Goods Ltd',
        contact: 'Anil Singhania',
        phone: '+91 99001 11222',
        terms: 15,
        maxDays: 10,
        maxPct: 40,
        critical: true,
      },
      {
        code: 'SUP-02',
        name: 'Hindustan FMCG Supplies',
        contact: 'Vikram Seth',
        phone: '+91 99002 22333',
        terms: 30,
        maxDays: 15,
        maxPct: 50,
        critical: false,
      },
      {
        code: 'SUP-03',
        name: 'National Agro Distributions',
        contact: 'Gurpreet Singh',
        phone: '+91 99003 33444',
        terms: 21,
        maxDays: 10,
        maxPct: 30,
        critical: false,
      },
      {
        code: 'SUP-04',
        name: 'Metro Pack Packaging',
        contact: 'Sanjay Jain',
        phone: '+91 99004 44555',
        terms: 30,
        maxDays: 14,
        maxPct: 50,
        critical: false,
      },
    ];

    const supplierMap = new Map<string, string>();
    for (const s of supplierSeedData) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO suppliers (
          business_id, supplier_code, name, contact_name, phone_masked,
          max_deferral_days, max_deferral_pct, is_critical
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [businessId, s.code, s.name, s.contact, s.phone, s.maxDays, s.maxPct, s.critical],
      );
      supplierMap.set(s.code, res.rows[0].id);
    }

    // 4. Invoices (Realistic mix of Overdue, Issued, Partially Paid, and Historical Paid)
    // As of Day 0 (2026-11-13)
    const invoiceSeedData = [
      // Overdue Invoices
      {
        retCode: 'RET-01',
        num: 'INV-2026-089',
        issue: '2026-10-15',
        due: '2026-10-30',
        total: '8000000', // ₹80,000
        paid: '0',
        outstanding: '8000000',
        status: 'OPEN',
        evidence: 'UNCONFIRMED',
        notes: 'Urgent collection required. Retailer promised partial payment of ₹40,000.',
      },
      {
        retCode: 'RET-02',
        num: 'INV-2026-092',
        issue: '2026-10-20',
        due: '2026-11-10',
        total: '5000000', // ₹50,000
        paid: '2000000', // ₹20,000 paid
        outstanding: '3000000', // ₹30,000 remaining
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: '₹20,000 received via IMPS; balance of ₹30,000 promised on 17-Nov.',
      },
      {
        retCode: 'RET-03',
        num: 'INV-2026-094',
        issue: '2026-10-22',
        due: '2026-11-06',
        total: '3500000', // ₹35,000
        paid: '0',
        outstanding: '3500000',
        status: 'OPEN',
        evidence: 'UNCONFIRMED',
        notes: 'First reminder sent. Pending customer confirmation.',
      },
      {
        retCode: 'RET-12',
        num: 'INV-2026-095',
        issue: '2026-10-25',
        due: '2026-11-09',
        total: '4200000', // ₹42,000
        paid: '0',
        outstanding: '4200000',
        status: 'OPEN',
        evidence: 'UNCONFIRMED',
        notes: 'High risk retailer; requires in-person collection follow-up.',
      },
      // Upcoming Due Invoices
      {
        retCode: 'RET-04',
        num: 'INV-2026-101',
        issue: '2026-10-28',
        due: '2026-11-18',
        total: '3000000', // ₹30,000
        paid: '0',
        outstanding: '3000000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Standard monthly billing for staples.',
      },
      {
        retCode: 'RET-05',
        num: 'INV-2026-102',
        issue: '2026-11-01',
        due: '2026-11-16',
        total: '2500000', // ₹25,000
        paid: '0',
        outstanding: '2500000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Weekly replenishment order. Confirmed payment 16-Nov.',
      },
      {
        retCode: 'RET-06',
        num: 'INV-2026-103',
        issue: '2026-11-02',
        due: '2026-11-22',
        total: '4000000', // ₹40,000
        paid: '0',
        outstanding: '4000000',
        status: 'OPEN',
        evidence: 'UNCONFIRMED',
        notes: 'Confectionary and festive biscuits dispatch.',
      },
      {
        retCode: 'RET-07',
        num: 'INV-2026-104',
        issue: '2026-10-28',
        due: '2026-11-27',
        total: '9500000', // ₹95,000
        paid: '0',
        outstanding: '9500000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Hypermarket bulk delivery consignment.',
      },
      {
        retCode: 'RET-08',
        num: 'INV-2026-105',
        issue: '2026-11-05',
        due: '2026-11-20',
        total: '3500000', // ₹35,000
        paid: '0',
        outstanding: '3500000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Beverages and packaged snacks.',
      },
      {
        retCode: 'RET-09',
        num: 'INV-2026-106',
        issue: '2026-11-03',
        due: '2026-11-24',
        total: '6000000', // ₹60,000
        paid: '0',
        outstanding: '6000000',
        status: 'OPEN',
        evidence: 'UNCONFIRMED',
        notes: 'Personal care consignment.',
      },
      {
        retCode: 'RET-10',
        num: 'INV-2026-110',
        issue: '2026-11-08',
        due: '2026-11-23',
        total: '2000000', // ₹20,000
        paid: '0',
        outstanding: '2000000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Spices and staples.',
      },
      {
        retCode: 'RET-11',
        num: 'INV-2026-112',
        issue: '2026-11-09',
        due: '2026-11-30',
        total: '3800000', // ₹38,000
        paid: '0',
        outstanding: '3800000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Instant noodles and biscuits.',
      },
      {
        retCode: 'FB-R001',
        num: 'DEMO-R001-INV1',
        issue: '2026-11-02',
        due: '2026-11-28',
        total: '1000000', // ₹10,000
        paid: '0',
        outstanding: '1000000',
        status: 'OPEN',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Synthetic Retailer Payment Identification Demo (₹10,000 open).',
      },
      // Settled Historical Invoices
      {
        retCode: 'RET-04',
        num: 'INV-2026-071',
        issue: '2026-09-20',
        due: '2026-10-20',
        total: '4500000',
        paid: '4500000',
        outstanding: '0',
        status: 'PAID',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Fully settled on time via RTGS.',
      },
      {
        retCode: 'RET-05',
        num: 'INV-2026-075',
        issue: '2026-09-25',
        due: '2026-10-10',
        total: '2800000',
        paid: '2800000',
        outstanding: '0',
        status: 'PAID',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Settled on time via NEFT.',
      },
      {
        retCode: 'RET-08',
        num: 'INV-2026-080',
        issue: '2026-10-01',
        due: '2026-10-16',
        total: '3200000',
        paid: '3200000',
        outstanding: '0',
        status: 'PAID',
        evidence: 'CONFIRMED_PROMISE',
        notes: 'Prompt UPI settlement.',
      },
    ];

    const invoiceMap = new Map<string, string>();
    const seededInvoicesForForecast: CustomerInvoiceDTO[] = [];

    for (const inv of invoiceSeedData) {
      const retailerId = retailerMap.get(inv.retCode)!;
      const res = await client.query<{ id: string }>(
        `INSERT INTO customer_invoices (
          business_id, retailer_id, invoice_number, invoice_date, due_date,
          total_amount_paise, paid_amount_paise, status,
          evidence_status, external_reference, record_origin, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $3, 'SEEDED_DEMO', $10)
        RETURNING id`,
        [
          businessId,
          retailerId,
          inv.num,
          inv.issue,
          inv.due,
          inv.total,
          inv.paid,
          inv.status,
          inv.evidence,
          inv.notes,
        ],
      );
      const invId = res.rows[0].id;
      invoiceMap.set(inv.num, invId);

      if (inv.status === 'OPEN') {
        seededInvoicesForForecast.push({
          id: invId,
          businessId,
          retailerId,
          retailerCode: inv.retCode,
          retailerName: retailerSeedData.find((x) => x.code === inv.retCode)?.name || inv.retCode,
          invoiceNumber: inv.num,
          invoiceDate: inv.issue,
          dueDate: inv.due,
          totalAmountPaise: inv.total,
          paidAmountPaise: inv.paid,
          outstandingPaise: inv.outstanding,
          status: 'OPEN',
          evidenceStatus: inv.evidence as any,
          externalReference: inv.num,
          recordOrigin: 'SEEDED_DEMO',
          notes: inv.notes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // 5. Supplier Bills (Total Payables = ₹3,00,000)
    // CRITICAL SHORTAGE BILL: ₹1,50,000 due on 18-Nov-2026 to Apex Consumer Goods Ltd
    const billSeedData = [
      {
        supCode: 'SUP-01',
        num: 'BILL-APX-8821',
        issue: '2026-11-03',
        due: '2026-11-18',
        total: '15000000', // ₹1,50,000
        status: 'OPEN',
        priority: 'ESSENTIAL' as const,
        notes: 'Primary FMCG consignment. Strict payment terms required to maintain supply line.',
      },
      {
        supCode: 'SUP-02',
        num: 'BILL-HIN-4019',
        issue: '2026-10-25',
        due: '2026-11-25',
        total: '8000000', // ₹80,000
        status: 'OPEN',
        priority: 'NORMAL' as const,
        notes: 'Soaps and detergents stock replenishment.',
      },
      {
        supCode: 'SUP-03',
        num: 'BILL-NAT-1290',
        issue: '2026-11-02',
        due: '2026-11-23',
        total: '4500000', // ₹45,000
        status: 'OPEN',
        priority: 'NORMAL' as const,
        notes: 'Grains and pulses delivery.',
      },
      {
        supCode: 'SUP-04',
        num: 'BILL-MET-0982',
        issue: '2026-10-31',
        due: '2026-11-30',
        total: '2500000', // ₹25,000
        status: 'OPEN',
        priority: 'FLEXIBLE' as const,
        notes: 'Corrugated cartons and shrink wraps.',
      },
    ];

    const billMap = new Map<string, string>();
    const seededBillsForForecast: SupplierBillDTO[] = [];

    for (const b of billSeedData) {
      const supplierId = supplierMap.get(b.supCode)!;
      const res = await client.query<{ id: string }>(
        `INSERT INTO supplier_bills (
          business_id, supplier_id, bill_number, issue_date, due_date,
          total_amount_paise, paid_amount_paise, status,
          evidence_status, priority_tier, record_origin, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, '0', $7, 'CONFIRMED', $8, 'SEEDED_DEMO', $9)
        RETURNING id`,
        [businessId, supplierId, b.num, b.issue, b.due, b.total, b.status, b.priority, b.notes],
      );
      const bId = res.rows[0].id;
      billMap.set(b.num, bId);

      seededBillsForForecast.push({
        id: bId,
        businessId,
        supplierId,
        supplierCode: b.supCode,
        supplierName: supplierSeedData.find((x) => x.code === b.supCode)?.name || b.supCode,
        billNumber: b.num,
        issueDate: b.issue,
        dueDate: b.due,
        totalAmountPaise: b.total,
        paidAmountPaise: '0',
        outstandingPaise: b.total,
        status: 'OPEN',
        evidenceStatus: 'CONFIRMED',
        priorityTier: b.priority,
        recordOrigin: 'SEEDED_DEMO',
        notes: b.notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 6. Operating Expenses: Warehouse Power & Fleet Logistics (₹15,000 due 18-Nov-2026)
    const expRes = await client.query<{ id: string }>(
      `INSERT INTO operating_expenses (
        business_id, expense_code, category, description, due_date, amount_paise,
        paid_amount_paise, status, priority_tier, is_protected, record_origin
      ) VALUES ($1, 'EXP-B0007', 'UTILITIES_AND_LOGISTICS', 'Warehouse Power & Fleet Dispatch', '2026-11-18', '1500000',
        '0', 'SCHEDULED', 'ESSENTIAL', true, 'SEEDED_DEMO')
      RETURNING id`,
      [businessId],
    );

    const seededExpensesForForecast: OperatingExpenseDTO[] = [
      {
        id: expRes.rows[0].id,
        businessId,
        expenseCode: 'EXP-B0007',
        category: 'UTILITIES_AND_LOGISTICS',
        description: 'Warehouse Power & Fleet Dispatch',
        dueDate: '2026-11-18',
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

    // 7. Payment Commitments (Promise Tracking Radar)
    const commitmentSeedData = [
      {
        counterparty: 'RET-02',
        invNum: 'INV-2026-092',
        action: 'PARTIAL_COLLECTION',
        amount: '3000000', // ₹30,000
        date: '2026-11-17',
        status: 'AGREED',
        notes: 'Suresh Patel committed to transfer remaining balance of ₹30,000 on 17-Nov before supplier due date.',
      },
      {
        counterparty: 'RET-01',
        invNum: 'INV-2026-089',
        action: 'PARTIAL_COLLECTION',
        amount: '4000000', // ₹40,000
        date: '2026-11-05',
        status: 'FAILED',
        notes: 'Manoj promised ₹40,000 on 5-Nov but NEFT transfer failed; urgent renegotiation needed.',
      },
      {
        counterparty: 'RET-05',
        invNum: 'INV-2026-102',
        action: 'EARLY_RECEIPT',
        amount: '2500000', // ₹25,000
        date: '2026-11-16',
        status: 'AGREED',
        notes: 'Kailash Meena confirmed full payment via UPI on Monday 16-Nov.',
      },
    ];

    for (const c of commitmentSeedData) {
      const rId = retailerMap.get(c.counterparty)!;
      const invId = invoiceMap.get(c.invNum)!;
      await client.query(
        `INSERT INTO commitments (
          business_id, counterparty_type, retailer_id, customer_invoice_id,
          action_type, proposed_amount_paise, proposed_date, agreed_amount_paise, agreed_date,
          due_date, status, human_reply_recorded, human_reply_by, human_reply_notes, human_replied_at
        ) VALUES (
          $1, 'RETAILER', $2, $3, $4, $5, $6, $5, $6, $6, $7, true, 'Rajesh Sharma', $8, now()
        )`,
        [businessId, rId, invId, c.action, c.amount, c.date, c.status, c.notes],
      );
    }

    // 8. Demo Bank Import Batch & Transactions (Verified + Unmatched for Reconciliation)
    const batchRes = await client.query<{ id: string }>(
      `INSERT INTO bank_import_batches (
        business_id, source_type, filename, status, total_rows, inserted_rows, duplicate_rows, error_rows
      ) VALUES ($1, 'SEEDED_DEMO', 'hdfc_feed_nov_2026.json', 'COMPLETED', 5, 5, 0, 0)
      RETURNING id`,
      [businessId],
    );
    const batchId = batchRes.rows[0].id;

    // Past Verified Inflows
    const txRecords = [
      {
        amount: '4500000',
        type: 'INFLOW',
        date: '2026-10-20',
        method: 'BANK_TRANSFER',
        ref: 'RTGS/HDFC/2026102001',
        payer: 'Laxmi General Trading',
        retId: retailerMap.get('RET-04')!,
        status: 'MATCHED',
        alloc: 'ALLOCATED',
      },
      {
        amount: '2800000',
        type: 'INFLOW',
        date: '2026-10-10',
        method: 'BANK_TRANSFER',
        ref: 'NEFT/SBI/992837112',
        payer: 'Mahadev Retail Traders',
        retId: retailerMap.get('RET-05')!,
        status: 'MATCHED',
        alloc: 'ALLOCATED',
      },
      {
        amount: '2000000',
        type: 'INFLOW',
        date: '2026-11-10',
        method: 'BANK_TRANSFER',
        ref: 'IMPS/AXIS/440019283',
        payer: 'Krishna Superstore',
        retId: retailerMap.get('RET-02')!,
        status: 'MATCHED',
        alloc: 'ALLOCATED',
      },
      // Past Outflow
      {
        amount: '7500000',
        type: 'OUTFLOW',
        date: '2026-10-25',
        method: 'BANK_TRANSFER',
        ref: 'NEFT/HDFC/110928384',
        payer: 'Apex Consumer Goods Ltd',
        retId: null,
        status: 'UNMATCHED',
        alloc: 'ALLOCATED',
      },
      // Unmatched Incoming SMS Transaction (Transaction Evidence requiring reconciliation!)
      {
        amount: '2500000',
        type: 'INFLOW',
        date: '2026-11-12',
        method: 'UPI',
        ref: 'UPI/129384758291/CREDIT',
        payer: 'Unknown Payer / UPI-TRANSFER',
        retId: null,
        status: 'UNMATCHED',
        alloc: 'UNAPPLIED',
      },
    ];

    for (const tx of txRecords) {
      const txTs = `${tx.date}T10:30:00.000Z`;
      const fp = computeTransactionFingerprint(
        {
          direction: tx.type as any,
          paymentMethod: tx.method as any,
          externalTransactionReference: tx.ref,
          amountPaise: tx.amount,
          valueDate: tx.date,
          transactionTimestamp: txTs,
          payerIdentifierFingerprint: 'demo-fp',
          narration: `${tx.method}/${tx.ref}/${tx.payer}`,
        },
        env.TX_FINGERPRINT_SECRET,
      );

      const allocatedPaise = tx.alloc === 'ALLOCATED' ? tx.amount : '0';

      await client.query(
        `INSERT INTO payment_transactions (
          business_id, import_batch_id, direction, payment_method, external_transaction_reference,
          amount_paise, allocated_amount_paise, transaction_timestamp, value_date, transaction_fingerprint,
          match_status, matched_retailer_id, allocation_status, verification_status,
          source_type, payer_display_name, narration
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'VERIFIED', 'SEEDED_DEMO', $14, $15
        )`,
        [
          businessId,
          batchId,
          tx.type,
          tx.method,
          tx.ref,
          tx.amount,
          allocatedPaise,
          txTs,
          tx.date,
          fp,
          tx.status,
          tx.retId,
          tx.alloc,
          tx.payer,
          `${tx.method}/${tx.ref}/${tx.payer}`,
        ],
      );
    }

    // 9. Bank SMS Ingestion Evidence (HDFC, SBI bank notifications)
    const smsData = [
      {
        sender: 'HDFCBK',
        raw: 'INR 25,000.00 credited to your A/c XX4920 on 12-Nov-2026 by UPI Ref 129384758291. Avl Bal INR 60,000.00 - HDFC Bank',
        amt: '2500000',
        ref: '129384758291',
        date: '2026-11-12',
        tail: '4920',
        status: 'PARSED',
      },
      {
        sender: 'SBIINB',
        raw: 'Dear Customer, your A/c XX4920 credited with INR 20,000.00 on 10-Nov-2026 via IMPS Ref 440019283. SBI',
        amt: '2000000',
        ref: '440019283',
        date: '2026-11-10',
        tail: '4920',
        status: 'MATCHED',
      },
      {
        sender: 'HDFCBK',
        raw: 'INR 75,000.00 debited from A/c XX4920 on 25-Oct-2026 towards NEFT Ref 110928384 to APEX FMCG. Avl Bal INR 1,15,000.00',
        amt: '7500000',
        ref: '110928384',
        date: '2026-10-25',
        tail: '4920',
        status: 'MATCHED',
      },
    ];

    for (const s of smsData) {
      await client.query(
        `INSERT INTO transaction_sms_evidence (
          business_id, sender_header, raw_sms_body, parsed_amount_paise,
          parsed_reference_number, parsed_transaction_date, parsed_account_tail, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [businessId, s.sender, s.raw, s.amt, s.ref, s.date, s.tail, s.status],
      );
    }

    // 10. Generate baseline cash forecast snapshot
    const baseline = computeCashForecast({
      businessId,
      asOfDate: DEMO_DAY0,
      horizonDays: 30,
      openingCashPaise: '6000000', // ₹60,000
      minimumCashPaise: '5000000', // ₹50,000
      invoices: seededInvoicesForForecast,
      bills: seededBillsForForecast,
      expenses: seededExpensesForForecast,
    });

    await client.query(
      `INSERT INTO forecast_snapshots (
        business_id, scenario_id, snapshot_label, data_classification, as_of_date, horizon_days,
        first_breach_date, minimum_balance_paise, opening_cash_paise, series_json, diagnostics_json, input_fingerprint
      ) VALUES ($1, NULL, 'Deterministic Baseline Forecast (30-Day)', 'ACTUAL_PLUS_EXPECTED', $2, 30, $3, $4, $5, $6::jsonb, $7::jsonb, 'seed-sharma-v1')`,
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

    // 11. Ensure Demo Users exist
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
