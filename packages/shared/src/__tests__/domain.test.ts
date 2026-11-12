import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeCashForecast,
  diffDays,
  evaluatePromiseFailureRadar,
  findForbiddenCredentialKey,
  formatINR,
  maskPaymentIdentifier,
  normalizeIdentifierValue,
  parseIsoDate,
  rupeesToPaise,
  searchBoundedResolutions,
  type ApprovalLimits,
  type CommitmentDTO,
  type CustomerInvoiceDTO,
  type OperatingExpenseDTO,
  type SupplierBillDTO,
} from '../index.js';

const DAY0 = '2026-11-11';
const DAY4 = addDays(DAY0, 4);
const DAY5 = addDays(DAY0, 5);
const DAY10 = addDays(DAY0, 10);
const DAY12 = addDays(DAY0, 12);
const DAY14 = addDays(DAY0, 14);
const DAY15 = addDays(DAY0, 15);

function buildWorkedBlueprintFixtures() {
  const invoices: CustomerInvoiceDTO[] = [
    {
      id: 'inv-c3307',
      businessId: 'biz-1',
      retailerId: 'ret-b',
      retailerCode: 'RET-CUST-B',
      retailerName: 'Customer B (Bharat Kirana Mart)',
      invoiceNumber: 'C-3307',
      invoiceDate: '2026-11-01',
      dueDate: DAY10,
      totalAmountPaise: '6000000', // ₹60,000
      paidAmountPaise: '0',
      outstandingPaise: '6000000',
      status: 'OPEN',
      evidenceStatus: 'UNCONFIRMED',
      externalReference: 'C-3307',
      recordOrigin: 'SEEDED_DEMO',
      notes: 'Worked example Customer B receivable',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'inv-c3301',
      businessId: 'biz-1',
      retailerId: 'ret-a',
      retailerCode: 'RET-CUST-A',
      retailerName: 'Customer A (Anand Supermart)',
      invoiceNumber: 'C-3301',
      invoiceDate: '2026-11-01',
      dueDate: DAY14,
      totalAmountPaise: '2000000', // ₹20,000
      paidAmountPaise: '0',
      outstandingPaise: '2000000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED_PROMISE',
      externalReference: 'C-3301',
      recordOrigin: 'SEEDED_DEMO',
      notes: 'Illustrative early-receipt candidate',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const bills: SupplierBillDTO[] = [
    {
      id: 'bill-s2041',
      businessId: 'biz-1',
      supplierId: 'sup-a',
      supplierCode: 'SUP-A',
      supplierName: 'Supplier A (Shree Ganesh Traders)',
      billNumber: 'S-2041',
      issueDate: '2026-11-01',
      dueDate: DAY5,
      totalAmountPaise: '9500000', // ₹95,000
      paidAmountPaise: '0',
      outstandingPaise: '9500000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED',
      priorityTier: 'FLEXIBLE',
      recordOrigin: 'SEEDED_DEMO',
      notes: null,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const expenses: OperatingExpenseDTO[] = [
    {
      id: 'exp-b0007',
      businessId: 'biz-1',
      expenseCode: 'B-0007',
      category: 'UTILITIES_AND_LOGISTICS',
      description: 'Warehouse Power & Dispatch',
      dueDate: DAY5,
      amountPaise: '1500000', // ₹15,000
      paidAmountPaise: '0',
      outstandingPaise: '1500000',
      status: 'SCHEDULED',
      priorityTier: 'ESSENTIAL',
      isProtected: true,
      recordOrigin: 'SEEDED_DEMO',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  return { invoices, bills, expenses };
}

describe('Money and Date integrity helpers', () => {
  it('parses rupees to exact bigint paise and formats INR without floating point', () => {
    expect(rupeesToPaise('80000')).toBe(8000000n);
    expect(rupeesToPaise('95,000.50')).toBe(9500050n);
    expect(rupeesToPaise('-30000.00')).toBe(-3000000n);
    expect(formatINR(8000000n)).toBe('₹80,000.00');
    expect(formatINR('-3000000')).toBe('-₹30,000.00');
    expect(formatINR('12500000')).toBe('₹1,25,000.00');
    expect(() => rupeesToPaise('10.123')).toThrow();
  });

  it('validates ISO dates strictly', () => {
    expect(parseIsoDate('2026-11-11')).toBe('2026-11-11');
    expect(addDays('2026-11-11', 5)).toBe('2026-11-16');
    expect(diffDays('2026-11-11', '2026-11-21')).toBe(10);
    expect(() => parseIsoDate('2026-02-30')).toThrow();
    expect(() => parseIsoDate('11-11-2026')).toThrow();
  });

  it('normalizes, masks identifiers and rejects forbidden credentials', () => {
    expect(normalizeIdentifierValue('UPI_ID', '  RetailerA@OKICICI ')).toBe('UPI_ID:retailera@okicici');
    expect(maskPaymentIdentifier('UPI_ID', 'retailera@okicici')).toBe('re***a@okicici');
    expect(maskPaymentIdentifier('BANK_ACCOUNT', 'HDFC0001234:9876543210')).toBe('HDFC••••3210');
    expect(findForbiddenCredentialKey({ payerUpi: 'a@b', nested: { upiPin: '1234' } })).toBe('upiPin');
    expect(findForbiddenCredentialKey({ payerUpi: 'a@b', amountPaise: '100000' })).toBeNull();
  });
});

describe('Worked Blueprint Cash Gap Forecast & Resolution Engine', () => {
  it('reproduces Day 5 -₹30,000 breach and Day 10 +₹30,000 recovery', () => {
    const { invoices, bills, expenses } = buildWorkedBlueprintFixtures();
    const forecast = computeCashForecast({
      businessId: 'biz-1',
      asOfDate: DAY0,
      horizonDays: 15,
      openingCashPaise: '8000000', // ₹80,000
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
    });

    expect(forecast.days[5].date).toBe(DAY5);
    expect(forecast.days[5].closingBalancePaise).toBe('-3000000'); // -₹30,000
    expect(forecast.days[5].belowMinimum).toBe(true);

    expect(forecast.days[10].date).toBe(DAY10);
    expect(forecast.days[10].closingBalancePaise).toBe('3000000'); // +₹30,000
    expect(forecast.days[10].belowMinimum).toBe(false);

    expect(forecast.breach.firstBreachDate).toBe(DAY5);
    expect(forecast.breach.firstBreachDayIndex).toBe(5);
    expect(forecast.breach.shortfallPaise).toBe('3000000');
    expect(forecast.breach.isTimingGapOnly).toBe(true);
    expect(forecast.breach.outflowDrivers.map((d) => d.referenceCode)).toEqual(['S-2041', 'B-0007']);
  });

  it('keeps scenario evaluation isolated and verifies Plan A (+₹15,000 on Day 5) and delayed Customer B (-₹10,000 on Day 12)', () => {
    const { invoices, bills, expenses } = buildWorkedBlueprintFixtures();
    const snapshotBefore = JSON.stringify({ invoices, bills, expenses });

    const planAForecast = computeCashForecast({
      businessId: 'biz-1',
      asOfDate: DAY0,
      horizonDays: 15,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
      scenarioActions: [
        {
          targetType: 'CUSTOMER_INVOICE',
          targetId: 'inv-c3301',
          targetLabel: 'C-3301',
          actionType: 'ACCELERATE_INFLOW',
          amountPaise: '2000000', // ₹20,000 early by Day 4
          originalDate: DAY14,
          simulatedDate: DAY4,
        },
        {
          targetType: 'SUPPLIER_BILL',
          targetId: 'bill-s2041',
          targetLabel: 'S-2041',
          actionType: 'DEFER_OUTFLOW',
          amountPaise: '2500000', // ₹25,000 deferred from Day 5 to Day 12
          originalDate: DAY5,
          simulatedDate: DAY12,
        },
      ],
    });

    expect(planAForecast.classification).toBe('SCENARIO_WHAT_IF');
    expect(planAForecast.days[5].closingBalancePaise).toBe('1500000'); // +₹15,000
    expect(planAForecast.breach.firstBreachDate).toBeNull();

    // Now simulate Customer B delayed 5 days (Day 10 -> Day 15) on top of agreed Plan A commitments
    const agreedCommitments: CommitmentDTO[] = [
      {
        id: 'com-1',
        businessId: 'biz-1',
        counterpartyType: 'RETAILER',
        retailerId: 'ret-a',
        customerInvoiceId: 'inv-c3301',
        supplierId: null,
        supplierBillId: null,
        operatingExpenseId: null,
        scenarioId: null,
        actionType: 'EARLY_RECEIPT',
        proposedAmountPaise: '2000000',
        proposedDate: DAY4,
        agreedAmountPaise: '2000000',
        agreedDate: DAY4,
        dueDate: DAY4,
        status: 'AGREED',
        humanReplyRecorded: true,
        humanReplyBy: 'Ramesh (Anand Supermart)',
        humanReplyChannel: 'WHATSAPP',
        humanReplyNotes: 'Agreed to pay by Day 4',
        humanRepliedAt: '2026-11-11T09:00:00Z',
        fulfilledAmountPaise: '0',
        createdAt: '2026-11-11T08:30:00Z',
        updatedAt: '2026-11-11T09:00:00Z',
      },
      {
        id: 'com-2',
        businessId: 'biz-1',
        counterpartyType: 'SUPPLIER',
        retailerId: null,
        customerInvoiceId: null,
        supplierId: 'sup-a',
        supplierBillId: 'bill-s2041',
        operatingExpenseId: null,
        scenarioId: null,
        actionType: 'SUPPLIER_DEFERRAL',
        proposedAmountPaise: '2500000',
        proposedDate: DAY12,
        agreedAmountPaise: '2500000',
        agreedDate: DAY12,
        dueDate: DAY12,
        status: 'AGREED',
        humanReplyRecorded: true,
        humanReplyBy: 'Ganesh Traders Desk',
        humanReplyChannel: 'PHONE',
        humanReplyNotes: 'Approved 7-day part deferral',
        humanRepliedAt: '2026-11-11T09:15:00Z',
        fulfilledAmountPaise: '0',
        createdAt: '2026-11-11T08:35:00Z',
        updatedAt: '2026-11-11T09:15:00Z',
      },
    ];

    const radar = evaluatePromiseFailureRadar(
      {
        businessId: 'biz-1',
        asOfDate: DAY0,
        horizonDays: 16,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
        commitments: agreedCommitments,
      },
      [{ invoiceId: 'inv-c3307', delayDays: 5 }],
    );

    expect(radar.alerts).toHaveLength(1);
    expect(radar.alerts[0].alertType).toBe('DELAYED_INVOICE');
    expect(radar.rerunForecast.days[12].date).toBe(DAY12);
    expect(radar.rerunForecast.days[12].closingBalancePaise).toBe('-1000000'); // -₹10,000!
    expect(radar.rerunForecast.days[15].closingBalancePaise).toBe('5000000'); // +₹50,000 after delayed arrival
    expect(JSON.stringify({ invoices, bills, expenses })).toBe(snapshotBefore);
  });

  it('ignores PROPOSED commitments in baseline forecast until a human records agreement', () => {
    const { invoices, bills, expenses } = buildWorkedBlueprintFixtures();
    const proposedOnly: CommitmentDTO[] = [
      {
        id: 'com-prop',
        businessId: 'biz-1',
        counterpartyType: 'RETAILER',
        retailerId: 'ret-a',
        customerInvoiceId: 'inv-c3301',
        supplierId: null,
        supplierBillId: null,
        operatingExpenseId: null,
        scenarioId: null,
        actionType: 'EARLY_RECEIPT',
        proposedAmountPaise: '2000000',
        proposedDate: DAY4,
        agreedAmountPaise: null,
        agreedDate: null,
        dueDate: DAY4,
        status: 'PROPOSED',
        humanReplyRecorded: false,
        humanReplyBy: null,
        humanReplyChannel: null,
        humanReplyNotes: null,
        humanRepliedAt: null,
        fulfilledAmountPaise: '0',
        createdAt: '2026-11-11T08:30:00Z',
        updatedAt: '2026-11-11T08:30:00Z',
      },
    ];

    const forecast = computeCashForecast({
      businessId: 'biz-1',
      asOfDate: DAY0,
      horizonDays: 15,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
      commitments: proposedOnly,
    });

    // Day 5 must still be -₹30,000 because proposal was NOT agreed by human
    expect(forecast.days[5].closingBalancePaise).toBe('-3000000');
  });

  it('includes VERIFIED actual bank payments on valueDate >= asOfDate without double counting settled invoices', () => {
    const { invoices, bills, expenses } = buildWorkedBlueprintFixtures();
    // Simulate Customer A invoice C-3301 (₹20,000) settled via actual verified UPI payment on Day 4
    invoices[1].paidAmountPaise = '2000000';
    invoices[1].outstandingPaise = '0';
    invoices[1].status = 'PAID';
    invoices[1].evidenceStatus = 'VERIFIED_PAID';

    const forecast = computeCashForecast({
      businessId: 'biz-1',
      asOfDate: DAY0,
      horizonDays: 15,
      openingCashPaise: '8000000',
      minimumCashPaise: '0',
      invoices,
      bills,
      expenses,
      transactions: [
        {
          id: 'tx-actual-day4',
          businessId: 'biz-1',
          importBatchId: null,
          direction: 'INFLOW',
          paymentMethod: 'UPI',
          externalTransactionReference: 'UTR-ACTUAL-C3301',
          explicitInvoiceReference: 'C-3301',
          payerIdentifierMasked: 'an***t@okhdfcbank',
          payerDisplayName: 'Anand Supermart',
          narration: 'Early settlement of C-3301',
          amountPaise: '2000000',
          allocatedAmountPaise: '2000000',
          unappliedCreditPaise: '0',
          remainingToAllocatePaise: '0',
          transactionTimestamp: `${DAY4}T10:00:00Z`,
          valueDate: DAY4,
          matchStatus: 'MATCHED',
          matchedRetailerId: 'ret-a',
          matchEvidence: {
            decision: 'MATCHED',
            rule: 'EXACT_VERIFIED_UPI_HMAC',
            explanation: 'Verified match',
            candidates: [],
          },
          allocationStatus: 'ALLOCATED',
          verificationStatus: 'VERIFIED',
          sourceType: 'CSV_IMPORT',
          reversalOfTransactionId: null,
          isReversed: false,
          createdAt: `${DAY4}T10:00:00Z`,
          updatedAt: `${DAY4}T10:00:00Z`,
        },
      ],
    });

    expect(forecast.days[4].closingBalancePaise).toBe('10000000'); // ₹80k + ₹20k ACTUAL
    expect(forecast.days[4].items[0].classification).toBe('ACTUAL');
    expect(forecast.days[5].closingBalancePaise).toBe('-1000000'); // ₹100k - ₹110k = -₹10k
    expect(forecast.days[14].totalInflowsPaise).toBe('0'); // Not double-counted on original due date
  });

  it('finds bounded feasible plans and triggers NO_FEASIBLE_PLAN + Survival Mode when limits are tight', () => {
    const { invoices, bills, expenses } = buildWorkedBlueprintFixtures();
    const limits: ApprovalLimits = {
      maxEarlyRequestPct: 100,
      maxEarlyDays: 14,
      defaultMaxSupplierDeferralPct: 40,
      defaultMaxSupplierDeferralDays: 10,
      protectEssentialExpenses: true,
      maxActionsPerPlan: 2,
    };

    const supplierMap = new Map([
      ['sup-a', { maxDeferralDays: 10, maxDeferralPct: 40, isCritical: false }],
    ]);

    const res = searchBoundedResolutions(
      {
        businessId: 'biz-1',
        asOfDate: DAY0,
        horizonDays: 15,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
      },
      limits,
      supplierMap,
    );

    expect(res.status).toBe('FEASIBLE_PLANS_FOUND');
    expect(res.totalCombinationsEvaluated).toBe(30);
    expect(res.gridDimensions).toEqual({
      earlyReceiptChoices: 3,
      supplierDeferralChoices: 5,
      expenseDeferralChoices: 2,
    });
    expect(res.feasiblePlans.length).toBeGreaterThan(0);

    // Demo Plan A (early ₹20,000 by Day 4 + defer ₹25,000 of S-2041 from Day 5 to Day 12 -> +₹15,000 on Day 5)
    const demoPlanA = res.feasiblePlans.find(
      (p) =>
        p.actions.some((a) => a.targetCode === 'C-3301' && a.amountPaise === '2000000') &&
        p.actions.some((a) => a.targetCode === 'S-2041' && a.amountPaise === '2500000'),
    );
    expect(demoPlanA).toBeDefined();
    expect(demoPlanA!.forecast.days[5].closingBalancePaise).toBe('1500000');

    // Tighten limits so no bounded plan can close -₹30,000 gap
    const tightRes = searchBoundedResolutions(
      {
        businessId: 'biz-1',
        asOfDate: DAY0,
        horizonDays: 15,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
      },
      {
        ...limits,
        maxEarlyRequestPct: 10, // max ₹2,000 early
        defaultMaxSupplierDeferralPct: 10, // max ₹9,500 deferral -> total ₹11,500 < ₹30,000 gap
      },
      new Map([['sup-a', { maxDeferralDays: 10, maxDeferralPct: 10, isCritical: false }]]),
    );

    expect(tightRes.status).toBe('NO_FEASIBLE_PLAN');
    expect(tightRes.emergencyLevers.length).toBe(4);
    expect(tightRes.emergencySummary).toContain('NO FEASIBLE PLAN');
    expect(tightRes.survivalModePriorities[0].referenceCode).toBe('B-0007');
    expect(tightRes.survivalModePriorities[0].recommendation).toBe('PAY_ON_TIME');
  });

  it('flags UNKNOWN_NEEDS_REVIEW instead of false miss when bank data is incomplete and produces replan on delayed receipt', () => {
    const { invoices, bills, expenses } = buildWorkedBlueprintFixtures();
    const limits: ApprovalLimits = {
      maxEarlyRequestPct: 100,
      maxEarlyDays: 14,
      defaultMaxSupplierDeferralPct: 40,
      defaultMaxSupplierDeferralDays: 10,
      protectEssentialExpenses: true,
      maxActionsPerPlan: 2,
    };

    const duePastCommitment: CommitmentDTO = {
      id: 'com-past',
      businessId: 'biz-1',
      counterpartyType: 'RETAILER',
      retailerId: 'ret-a',
      customerInvoiceId: 'inv-c3301',
      supplierId: null,
      supplierBillId: null,
      operatingExpenseId: null,
      scenarioId: null,
      actionType: 'EARLY_RECEIPT',
      proposedAmountPaise: '2000000',
      proposedDate: DAY4,
      agreedAmountPaise: '2000000',
      agreedDate: DAY4,
      dueDate: DAY4,
      status: 'AGREED',
      humanReplyRecorded: true,
      humanReplyBy: 'Ramesh',
      humanReplyChannel: 'WHATSAPP',
      humanReplyNotes: 'Agreed Day 4',
      humanRepliedAt: '2026-11-11T09:00:00Z',
      fulfilledAmountPaise: '0',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T09:00:00Z',
    };

    // As of Day 5 with NO bank imports yet -> must show UNKNOWN_NEEDS_REVIEW, not MISSED_COMMITMENT
    const incompleteReport = evaluatePromiseFailureRadar(
      {
        businessId: 'biz-1',
        asOfDate: DAY5,
        horizonDays: 15,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
        commitments: [duePastCommitment],
        transactions: [],
      },
      [],
      { limits },
    );
    expect(incompleteReport.hasIncompleteBankData).toBe(true);
    expect(incompleteReport.alerts[0].alertType).toBe('UNKNOWN_NEEDS_REVIEW');

    // When bank data covers Day 5 cleanly -> marks MISSED_COMMITMENT and triggers replanResult
    const completeReport = evaluatePromiseFailureRadar(
      {
        businessId: 'biz-1',
        asOfDate: DAY5,
        horizonDays: 15,
        openingCashPaise: '8000000',
        minimumCashPaise: '0',
        invoices,
        bills,
        expenses,
        commitments: [duePastCommitment],
        transactions: [],
      },
      [],
      {
        limits,
        latestBankImportDate: DAY5,
      },
    );
    expect(completeReport.alerts[0].alertType).toBe('MISSED_COMMITMENT');
    expect(completeReport.replanResult).not.toBeNull();
  });
});

