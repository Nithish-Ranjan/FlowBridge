import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeCashForecast,
  evaluatePromiseFailureRadar,
  paiseToDecimalInput,
  type CommitmentDTO,
  type CustomerInvoiceDTO,
  type OperatingExpenseDTO,
  type SupplierBillDTO,
} from '../index.js';

const BIZ_ID = '00000000-0000-4000-8000-000000000001';
const DAY_0 = '2026-11-11';
const NOW_ISO = '2026-11-11T00:00:00.000Z';

function buildScenarioInputs() {
  const invoices: CustomerInvoiceDTO[] = [
    {
      id: 'inv-c3307',
      businessId: BIZ_ID,
      retailerId: 'ret-b',
      retailerCode: 'FB-R002',
      retailerName: 'Customer B Traders',
      invoiceNumber: 'C-3307',
      invoiceDate: DAY_0,
      dueDate: addDays(DAY_0, 10),
      totalAmountPaise: '6000000',
      paidAmountPaise: '0',
      outstandingPaise: '6000000',
      status: 'OPEN',
      evidenceStatus: 'UNCONFIRMED',
      externalReference: null,
      recordOrigin: 'SEEDED_DEMO',
      notes: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
    {
      id: 'inv-c3301',
      businessId: BIZ_ID,
      retailerId: 'ret-a',
      retailerCode: 'FB-R003',
      retailerName: 'Customer A Mart',
      invoiceNumber: 'C-3301',
      invoiceDate: DAY_0,
      dueDate: addDays(DAY_0, 14),
      totalAmountPaise: '4000000',
      paidAmountPaise: '0',
      outstandingPaise: '4000000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED_PROMISE',
      externalReference: null,
      recordOrigin: 'SEEDED_DEMO',
      notes: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
  ];

  const bills: SupplierBillDTO[] = [
    {
      id: 'bill-s2041',
      businessId: BIZ_ID,
      supplierId: 'sup-a',
      supplierCode: 'SUP-A',
      supplierName: 'Supplier A',
      billNumber: 'S-2041',
      issueDate: DAY_0,
      dueDate: addDays(DAY_0, 5),
      totalAmountPaise: '9500000',
      paidAmountPaise: '0',
      outstandingPaise: '9500000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED',
      priorityTier: 'FLEXIBLE',
      recordOrigin: 'SEEDED_DEMO',
      notes: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
  ];

  const expenses: OperatingExpenseDTO[] = [
    {
      id: 'exp-b0007',
      businessId: BIZ_ID,
      expenseCode: 'B-0007',
      category: 'Payroll & Rent',
      description: 'Essential operating expense',
      dueDate: addDays(DAY_0, 5),
      amountPaise: '1500000',
      paidAmountPaise: '0',
      outstandingPaise: '1500000',
      status: 'SCHEDULED',
      priorityTier: 'ESSENTIAL',
      isProtected: true,
      recordOrigin: 'SEEDED_DEMO',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
  ];

  return { invoices, bills, expenses };
}

function makePlanACommitments(statuses: ['PROPOSED' | 'AGREED', 'PROPOSED' | 'AGREED']): CommitmentDTO[] {
  const [cStatus, sStatus] = statuses;
  return [
    {
      id: 'com-c3301',
      businessId: BIZ_ID,
      counterpartyType: 'RETAILER',
      retailerId: 'ret-a',
      customerInvoiceId: 'inv-c3301',
      supplierId: null,
      supplierBillId: null,
      operatingExpenseId: null,
      scenarioId: null,
      actionType: 'EARLY_RECEIPT',
      proposedAmountPaise: '2000000',
      proposedDate: addDays(DAY_0, 4),
      agreedAmountPaise: cStatus === 'AGREED' ? '2000000' : null,
      agreedDate: cStatus === 'AGREED' ? addDays(DAY_0, 4) : null,
      dueDate: addDays(DAY_0, 4),
      status: cStatus,
      humanReplyRecorded: cStatus === 'AGREED',
      humanReplyBy: cStatus === 'AGREED' ? 'Customer A' : null,
      humanReplyChannel: cStatus === 'AGREED' ? 'WHATSAPP' : null,
      humanReplyNotes: null,
      humanRepliedAt: cStatus === 'AGREED' ? NOW_ISO : null,
      fulfilledAmountPaise: '0',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
    {
      id: 'com-s2041',
      businessId: BIZ_ID,
      counterpartyType: 'SUPPLIER',
      retailerId: null,
      customerInvoiceId: null,
      supplierId: 'sup-a',
      supplierBillId: 'bill-s2041',
      operatingExpenseId: null,
      scenarioId: null,
      actionType: 'SUPPLIER_DEFERRAL',
      proposedAmountPaise: '2500000',
      proposedDate: addDays(DAY_0, 12),
      agreedAmountPaise: sStatus === 'AGREED' ? '2500000' : null,
      agreedDate: sStatus === 'AGREED' ? addDays(DAY_0, 12) : null,
      dueDate: addDays(DAY_0, 12),
      status: sStatus,
      humanReplyRecorded: sStatus === 'AGREED',
      humanReplyBy: sStatus === 'AGREED' ? 'Supplier A' : null,
      humanReplyChannel: sStatus === 'AGREED' ? 'PHONE' : null,
      humanReplyNotes: null,
      humanRepliedAt: sStatus === 'AGREED' ? NOW_ISO : null,
      fulfilledAmountPaise: '0',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
  ];
}

describe('Acceptance Scenarios & Integer UI Formatting Verification', () => {
  it('converts bigint/string paise to form decimal string cleanly without IEEE-754 float precision loss', () => {
    expect(paiseToDecimalInput('0')).toBe('0');
    expect(paiseToDecimalInput('8000000')).toBe('80000');
    expect(paiseToDecimalInput('100050')).toBe('1000.5');
    expect(paiseToDecimalInput('-3000000')).toBe('-30000');
    expect(paiseToDecimalInput(9999999999999905n)).toBe('99999999999999.05');
  });

  it('Scenario D: enforces human two-agreement gate before removing Day-5 shortfall and leaves source dates untouched', () => {
    const { invoices, bills, expenses } = buildScenarioInputs();

    // 1) Both commitments PROPOSED -> Day 5 still breaches at -₹30,000
    const proposedOnly = computeCashForecast({
      businessId: BIZ_ID,
      asOfDate: DAY_0,
      horizonDays: 16,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
      commitments: makePlanACommitments(['PROPOSED', 'PROPOSED']),
    });
    expect(proposedOnly.days[5].closingBalancePaise).toBe('-3000000');
    expect(proposedOnly.breach.firstBreachDate).toBe(addDays(DAY_0, 5));

    // 2) Only Customer A AGREED (1 of 2) -> Day 5 still breaches at -₹10,000
    const partialAgreed = computeCashForecast({
      businessId: BIZ_ID,
      asOfDate: DAY_0,
      horizonDays: 16,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
      commitments: makePlanACommitments(['AGREED', 'PROPOSED']),
    });
    expect(partialAgreed.days[5].closingBalancePaise).toBe('-1000000');
    expect(partialAgreed.breach.firstBreachDate).toBe(addDays(DAY_0, 5));

    // 3) Both AGREED -> Day 5 becomes +₹15,000 with zero breaches
    const bothAgreed = computeCashForecast({
      businessId: BIZ_ID,
      asOfDate: DAY_0,
      horizonDays: 16,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
      commitments: makePlanACommitments(['AGREED', 'AGREED']),
    });
    expect(bothAgreed.days[5].closingBalancePaise).toBe('1500000');
    expect(bothAgreed.breach.firstBreachDate).toBeNull();

    // Source ledger due dates remain untouched
    expect(invoices[1].dueDate).toBe(addDays(DAY_0, 14));
    expect(bills[0].dueDate).toBe(addDays(DAY_0, 5));
  });

  it('Scenario E: Customer B +5d delay causes Day-12 -₹10,000 breach & triggers Failure Radar + replanResult; guards incomplete bank data as UNKNOWN_NEEDS_REVIEW', () => {
    const { invoices, bills, expenses } = buildScenarioInputs();
    const commitments = makePlanACommitments(['AGREED', 'AGREED']);

    // Customer B (C-3307) slips +5 days -> Day 12 (2026-11-23) becomes -₹10,000
    const radarDelay = evaluatePromiseFailureRadar(
      {
        businessId: BIZ_ID,
        asOfDate: DAY_0,
        horizonDays: 16,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
        commitments,
      },
      [{ invoiceId: 'inv-c3307', delayDays: 5 }],
      {
        limits: {
          maxEarlyRequestPct: 50,
          maxEarlyDays: 12,
          defaultMaxSupplierDeferralPct: 30,
          defaultMaxSupplierDeferralDays: 10,
          protectEssentialExpenses: true,
          maxActionsPerPlan: 2,
        },
        latestBankImportDate: DAY_0,
      },
    );

    expect(radarDelay.alerts.some((a) => a.alertType === 'DELAYED_INVOICE' && a.referenceCode === 'C-3307')).toBe(true);
    expect(radarDelay.rerunForecast.breach.firstBreachDate).toBe(addDays(DAY_0, 12));
    expect(radarDelay.rerunForecast.breach.firstBreachClosingPaise).toBe('-1000000');
    expect(radarDelay.replanResult).not.toBeNull();

    // Incomplete bank feed on Day 5 (bank data only through Day 4 while C-3301 was due Day 4, wait due < asOfDate):
    // Evaluate on Day 5 (2026-11-16): C-3301 commitment due Day 4 (2026-11-15).
    // With bank feed complete only through Day 3 (2026-11-14) -> must report UNKNOWN_NEEDS_REVIEW, not MISSED_COMMITMENT.
    const day5Incomplete = evaluatePromiseFailureRadar(
      {
        businessId: BIZ_ID,
        asOfDate: addDays(DAY_0, 5),
        horizonDays: 15,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
        commitments,
      },
      [],
      { latestBankImportDate: addDays(DAY_0, 3) },
    );
    expect(day5Incomplete.hasIncompleteBankData).toBe(true);
    expect(day5Incomplete.alerts.some((a) => a.alertType === 'UNKNOWN_NEEDS_REVIEW')).toBe(true);
    expect(day5Incomplete.alerts.some((a) => a.alertType === 'MISSED_COMMITMENT')).toBe(false);

    // With verified bank feed covering Day 4 (latestBankImportDate = Day 5) -> reports MISSED_COMMITMENT
    const day5Complete = evaluatePromiseFailureRadar(
      {
        businessId: BIZ_ID,
        asOfDate: addDays(DAY_0, 5),
        horizonDays: 15,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
        commitments,
      },
      [],
      { latestBankImportDate: addDays(DAY_0, 5) },
    );
    expect(day5Complete.hasIncompleteBankData).toBe(false);
    expect(day5Complete.alerts.some((a) => a.alertType === 'MISSED_COMMITMENT')).toBe(true);
  });
});

