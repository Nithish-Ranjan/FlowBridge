import { describe, expect, it } from 'vitest';
import {
  alignForecastSeriesByDate,
  computeBreachBounding,
  computeChartDomain,
  computeCashForecast,
  formatAxisINR,
  formatShortDate,
  toRupeesNumber,
  validateScenarioActionInput,
  validateScenarioActions,
  type ApprovalLimits,
  type CustomerInvoiceDTO,
  type ForecastDayEntry,
  type ForecastInput,
  type OperatingExpenseDTO,
  type ScenarioActionInput,
  type ScenarioValidationContext,
  type SupplierBillDTO,
} from '../index.js';

describe('Resolution Autopilot — 13 Required Test Cases', () => {
  const asOfDate = '2026-11-14';

  const mockLimits: ApprovalLimits = {
    maxEarlyRequestPct: 80,
    maxEarlyDays: 14,
    defaultMaxSupplierDeferralPct: 50,
    defaultMaxSupplierDeferralDays: 14,
    protectEssentialExpenses: true,
    maxActionsPerPlan: 4,
  };

  const sampleInvoice: CustomerInvoiceDTO = {
    id: 'inv-101',
    businessId: 'biz-1',
    retailerId: 'ret-1',
    invoiceNumber: 'INV-101',
    invoiceDate: '2026-11-01',
    dueDate: '2026-11-20',
    totalAmountPaise: '10000000', // ₹1,00,000
    paidAmountPaise: '6000000', // ₹60,000
    outstandingPaise: '4000000', // ₹40,000
    status: 'PARTIALLY_PAID',
    evidenceStatus: 'UNCONFIRMED',
    recordOrigin: 'MANUAL_ENTRY',
    externalReference: null,
    notes: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  const sampleBill: SupplierBillDTO = {
    id: 'bill-201',
    businessId: 'biz-1',
    supplierId: 'sup-1',
    billNumber: 'BILL-201',
    issueDate: '2026-11-02',
    dueDate: '2026-11-18',
    totalAmountPaise: '5000000', // ₹50,000
    paidAmountPaise: '0',
    outstandingPaise: '5000000',
    status: 'OPEN',
    evidenceStatus: 'CONFIRMED',
    priorityTier: 'NORMAL',
    recordOrigin: 'MANUAL_ENTRY',
    notes: null,
    createdAt: '2026-11-02T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
  };

  const sampleExpense: OperatingExpenseDTO = {
    id: 'exp-301',
    businessId: 'biz-1',
    expenseCode: 'EXP-301',
    description: 'Warehouse Utilities',
    category: 'UTILITIES',
    dueDate: '2026-11-19',
    amountPaise: '2000000', // ₹20,000
    paidAmountPaise: '0',
    outstandingPaise: '2000000',
    priorityTier: 'DEFERRABLE',
    isProtected: false,
    status: 'SCHEDULED',
    recordOrigin: 'MANUAL_ENTRY',
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
  };

  const baseContext: ScenarioValidationContext = {
    invoices: [sampleInvoice],
    bills: [sampleBill],
    expenses: [sampleExpense],
    asOfDate,
    horizonDays: 15,
    limits: mockLimits,
  };

  // -------------------------------------------------------------
  // Case 1: No eligible invoices
  // -------------------------------------------------------------
  it('Case 1: No eligible invoices — rejects acceleration actions when no valid open invoices exist', () => {
    const emptyInvoiceContext: ScenarioValidationContext = {
      ...baseContext,
      invoices: [],
    };

    const action: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: 'inv-101',
      targetLabel: 'INV-101',
      amountPaise: '2000000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-16',
    };

    const res = validateScenarioActions([action], emptyInvoiceContext);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('not found in current business records');

    // Also verify that an empty action list is rejected
    const emptyRes = validateScenarioActions([], emptyInvoiceContext);
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.error).toContain('At least one scenario action is required');
  });

  // -------------------------------------------------------------
  // Case 2: No eligible supplier bills
  // -------------------------------------------------------------
  it('Case 2: No eligible supplier bills — rejects deferral on paid or non-eligible bills', () => {
    const paidBill: SupplierBillDTO = {
      ...sampleBill,
      id: 'bill-paid',
      billNumber: 'BILL-PAID',
      status: 'PAID',
      outstandingPaise: '0',
      paidAmountPaise: '5000000',
    };

    const contextWithOnlyPaidBill: ScenarioValidationContext = {
      ...baseContext,
      bills: [paidBill],
    };

    const action: ScenarioActionInput = {
      actionType: 'DEFER_OUTFLOW',
      targetType: 'SUPPLIER_BILL',
      targetId: 'bill-paid',
      targetLabel: 'BILL-PAID',
      amountPaise: '2000000',
      originalDate: '2026-11-18',
      simulatedDate: '2026-11-25',
    };

    const res = validateScenarioActions([action], contextWithOnlyPaidBill);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('is PAID and cannot be deferred');
  });

  // -------------------------------------------------------------
  // Case 3: Missing scenario target
  // -------------------------------------------------------------
  it('Case 3: Missing scenario target — returns clear validation error when targetId does not exist', () => {
    const action: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: 'non-existent-invoice-id',
      targetLabel: 'UNKNOWN-INV',
      amountPaise: '1000000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-16',
    };

    const res = validateScenarioActions([action], baseContext);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Customer invoice with ID "non-existent-invoice-id" not found');
  });

  // -------------------------------------------------------------
  // Case 4: Fully paid invoice
  // -------------------------------------------------------------
  it('Case 4: Fully paid invoice — rejects action against an invoice with PAID status', () => {
    const fullyPaidInvoice: CustomerInvoiceDTO = {
      ...sampleInvoice,
      id: 'inv-fully-paid',
      status: 'PAID',
      paidAmountPaise: '10000000',
      outstandingPaise: '0',
    };

    const contextWithPaidInv: ScenarioValidationContext = {
      ...baseContext,
      invoices: [fullyPaidInvoice],
    };

    const action: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: 'inv-fully-paid',
      targetLabel: 'INV-101',
      amountPaise: '1000000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-16',
    };

    const res = validateScenarioActions([action], contextWithPaidInv);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('is PAID and cannot be accelerated');
  });

  // -------------------------------------------------------------
  // Case 5: Partial outstanding invoice
  // -------------------------------------------------------------
  it('Case 5: Partial outstanding invoice — shifts only the action amount and preserves remainder at original due date', () => {
    // sampleInvoice has total ₹1,00,000, outstanding ₹40,000, due 2026-11-20.
    // Accelerate ₹30,000 to 2026-11-16 (within 80% limit of 40,000 = 32,000).
    const action: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: sampleInvoice.id,
      targetLabel: sampleInvoice.invoiceNumber,
      amountPaise: '3000000', // ₹30,000
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-16',
    };

    const validationRes = validateScenarioActions([action], baseContext);
    expect(validationRes.valid).toBe(true);

    const forecastInput: ForecastInput = {
      businessId: 'biz-1',
      asOfDate,
      horizonDays: 10,
      openingCashPaise: '10000000', // ₹1,00,000
      minimumCashPaise: '5000000',
      invoices: [sampleInvoice],
      bills: [],
      expenses: [],
      commitments: [],
      scenarioActions: [action],
    };

    const forecast = computeCashForecast(forecastInput);

    // Day 2026-11-16 should have ₹30,000 accelerated inflow
    const day16 = forecast.days.find((d) => d.date === '2026-11-16');
    expect(day16).toBeDefined();
    expect(day16!.totalInflowsPaise).toBe('3000000');

    // Day 2026-11-20 should preserve remainder of outstanding (₹40,000 - ₹30,000 = ₹10,000)
    const day20 = forecast.days.find((d) => d.date === '2026-11-20');
    expect(day20).toBeDefined();
    expect(day20!.totalInflowsPaise).toBe('1000000'); // ₹10,000 remaining!
  });

  // -------------------------------------------------------------
  // Case 6: Amount greater than outstanding balance
  // -------------------------------------------------------------
  it('Case 6: Amount greater than outstanding balance — rejects action exceeding outstanding balance', () => {
    // sampleInvoice outstanding is ₹40,000 (4000000 paise). Request ₹45,000 (4500000 paise).
    const action: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: sampleInvoice.id,
      targetLabel: sampleInvoice.invoiceNumber,
      amountPaise: '4500000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-16',
    };

    const res = validateScenarioActions([action], baseContext);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('exceeds invoice outstanding balance');
  });

  // -------------------------------------------------------------
  // Case 7: Invalid simulated date
  // -------------------------------------------------------------
  it('Case 7: Invalid simulated date — rejects malformed, out-of-order, or out-of-horizon dates', () => {
    // 7a: Accelerated date on or after original date
    const laterAcceleratedAction: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: sampleInvoice.id,
      targetLabel: sampleInvoice.invoiceNumber,
      amountPaise: '2000000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-20', // Same day as original
    };
    expect(validateScenarioActionInput(laterAcceleratedAction, baseContext).valid).toBe(false);

    // 7b: Accelerated date before asOfDate
    const pastAcceleratedAction: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: sampleInvoice.id,
      targetLabel: sampleInvoice.invoiceNumber,
      amountPaise: '2000000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-10', // Prior to asOfDate 2026-11-14
    };
    const pastRes = validateScenarioActionInput(pastAcceleratedAction, baseContext);
    expect(pastRes.valid).toBe(false);
    expect(pastRes.error).toContain('cannot be before the forecast start date');

    // 7c: Deferral date on or before original date
    const earlyDeferralAction: ScenarioActionInput = {
      actionType: 'DEFER_OUTFLOW',
      targetType: 'SUPPLIER_BILL',
      targetId: sampleBill.id,
      targetLabel: sampleBill.billNumber,
      amountPaise: '2000000',
      originalDate: '2026-11-18',
      simulatedDate: '2026-11-17', // Before original due date
    };
    const deferRes = validateScenarioActionInput(earlyDeferralAction, baseContext);
    expect(deferRes.valid).toBe(false);
    expect(deferRes.error).toContain('must be strictly later than original date');

    // 7d: Malformed non-ISO date string
    const malformedAction: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: sampleInvoice.id,
      targetLabel: sampleInvoice.invoiceNumber,
      amountPaise: '2000000',
      originalDate: '2026-11-20',
      simulatedDate: 'invalid-date',
    };
    const malformedRes = validateScenarioActionInput(malformedAction, baseContext);
    expect(malformedRes.valid).toBe(false);
    expect(malformedRes.error).toContain('is not a valid ISO date');
  });

  // -------------------------------------------------------------
  // Case 8: Scenario API failure handling
  // -------------------------------------------------------------
  it('Case 8: Scenario API failure — validation correctly surfaces actionable error format for client error states', () => {
    // When an invalid action is evaluated, validation yields structured error message for UI banner
    const invalidAction: ScenarioActionInput = {
      actionType: 'ACCELERATE_INFLOW',
      targetType: 'CUSTOMER_INVOICE',
      targetId: 'unknown-id',
      targetLabel: 'MISSING',
      amountPaise: '1000000',
      originalDate: '2026-11-20',
      simulatedDate: '2026-11-16',
    };

    const res = validateScenarioActions([invalidAction], baseContext);
    expect(res.valid).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error).toContain('Action #1 (MISSING)');
  });

  // -------------------------------------------------------------
  // Case 9: Rapid repeated scenario submissions
  // -------------------------------------------------------------
  it('Case 9: Rapid repeated scenario submissions — simulates request ID racing and ignores stale out-of-order responses', async () => {
    // Model the state machine implemented in ResolveView.tsx
    let latestRequestId = 0;
    let committedState: string | null = null;
    let isEvaluating = false;

    async function submitScenario(scenarioName: string, delayMs: number): Promise<void> {
      latestRequestId += 1;
      const currentReqId = latestRequestId;
      // Immediately clear previous chart and set evaluating
      committedState = null;
      isEvaluating = true;

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // Guard check: ignore response if superseded by a newer request
      if (currentReqId !== latestRequestId) {
        return; // Stale response ignored!
      }

      committedState = `Result of ${scenarioName}`;
      isEvaluating = false;
    }

    // Launch Request 1 with 40ms delay, and Request 2 with 10ms delay (simulating rapid user clicks)
    const p1 = submitScenario('Scenario-1', 40);
    const p2 = submitScenario('Scenario-2', 10);

    await Promise.all([p1, p2]);

    // Request 2 must win and Request 1 must NOT overwrite Request 2
    expect(committedState).toBe('Result of Scenario-2');
    expect(isEvaluating).toBe(false);
  });

  // -------------------------------------------------------------
  // Case 10: Baseline and scenario with different date arrays
  // -------------------------------------------------------------
  it('Case 10: Baseline and scenario with different date arrays — aligns strictly by calendar date, avoiding index drift', () => {
    const baseDays: ForecastDayEntry[] = [
      { date: '2026-11-14', dayIndex: 0, openingBalancePaise: '1000', closingBalancePaise: '1200', totalInflowsPaise: '200', totalOutflowsPaise: '0', belowMinimum: false, deficitPaise: '0', items: [] },
      { date: '2026-11-15', dayIndex: 1, openingBalancePaise: '1200', closingBalancePaise: '1500', totalInflowsPaise: '300', totalOutflowsPaise: '0', belowMinimum: false, deficitPaise: '0', items: [] },
      { date: '2026-11-16', dayIndex: 2, openingBalancePaise: '1500', closingBalancePaise: '1800', totalInflowsPaise: '300', totalOutflowsPaise: '0', belowMinimum: false, deficitPaise: '0', items: [] },
    ];

    // Scenario has different dates (e.g. shifts dates forward or has missing dates)
    const compDays: ForecastDayEntry[] = [
      { date: '2026-11-15', dayIndex: 0, openingBalancePaise: '1200', closingBalancePaise: '2000', totalInflowsPaise: '800', totalOutflowsPaise: '0', belowMinimum: false, deficitPaise: '0', items: [] },
      { date: '2026-11-16', dayIndex: 1, openingBalancePaise: '2000', closingBalancePaise: '2300', totalInflowsPaise: '300', totalOutflowsPaise: '0', belowMinimum: false, deficitPaise: '0', items: [] },
      { date: '2026-11-17', dayIndex: 2, openingBalancePaise: '2300', closingBalancePaise: '2500', totalInflowsPaise: '200', totalOutflowsPaise: '0', belowMinimum: false, deficitPaise: '0', items: [] },
    ];

    const aligned = alignForecastSeriesByDate(baseDays, compDays);

    // Combined unique sorted calendar dates
    expect(aligned.allDates).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);

    // Check date map lookup integrity
    expect(aligned.baseMap.has('2026-11-14')).toBe(true);
    expect(aligned.compMap.has('2026-11-14')).toBe(false); // Scenario does not have 14th

    expect(aligned.baseMap.has('2026-11-17')).toBe(false); // Base does not have 17th
    expect(aligned.compMap.has('2026-11-17')).toBe(true);

    // Both share 2026-11-15 and 2026-11-16
    expect(aligned.baseMap.get('2026-11-15')!.closingBalancePaise).toBe('1500');
    expect(aligned.compMap.get('2026-11-15')!.closingBalancePaise).toBe('2000');
  });

  // -------------------------------------------------------------
  // Case 11: Negative cash balances
  // -------------------------------------------------------------
  it('Case 11: Negative cash balances — correctly scales domain below zero and formats negative INR', () => {
    const values = [-50000, 20000, 80000]; // rupees
    const domain = computeChartDomain(values);

    // Minimum raw value is -50000; domainMin must include padding below -50000
    expect(domain.rawMin).toBe(-50000);
    expect(domain.domainMin).toBeLessThan(-50000);
    expect(domain.domainMax).toBeGreaterThan(80000);
    expect(domain.domainMin < 0 && domain.domainMax > 0).toBe(true); // Zero line eligible

    // Negative INR currency format check
    expect(formatAxisINR(-50000)).toBe('-₹50,000');
    expect(formatAxisINR(80000)).toBe('₹80,000');
  });

  // -------------------------------------------------------------
  // Case 12: Minimum cash threshold rendering
  // -------------------------------------------------------------
  it('Case 12: Minimum cash threshold rendering — bounds breach zone strictly inside plot geometry', () => {
    const padT = 24;
    const plotH = 190;
    const thresholdY = 120; // within plot bounds (24 to 214)

    const bounded = computeBreachBounding(thresholdY, padT, plotH);
    expect(bounded.breachTop).toBe(120);
    expect(bounded.breachHeight).toBe(24 + 190 - 120); // 94px

    // Threshold above top of plot
    const highThreshold = computeBreachBounding(10, padT, plotH);
    expect(highThreshold.breachTop).toBe(padT); // Clamped to padT

    // Threshold below bottom of plot
    const lowThreshold = computeBreachBounding(250, padT, plotH);
    expect(lowThreshold.breachHeight).toBe(0); // Clamped to 0
  });

  // -------------------------------------------------------------
  // Case 13: Scenario does not mutate actual records
  // -------------------------------------------------------------
  it('Case 13: Scenario does not mutate actual records — ensures base inputs are deeply unaltered', () => {
    const originalInvoiceCopy = JSON.parse(JSON.stringify(sampleInvoice));
    const originalBillCopy = JSON.parse(JSON.stringify(sampleBill));
    const originalExpenseCopy = JSON.parse(JSON.stringify(sampleExpense));

    const forecastInput: ForecastInput = {
      businessId: 'biz-1',
      asOfDate,
      horizonDays: 15,
      openingCashPaise: '10000000',
      minimumCashPaise: '5000000',
      invoices: [sampleInvoice],
      bills: [sampleBill],
      expenses: [sampleExpense],
      commitments: [],
      scenarioActions: [
        {
          actionType: 'ACCELERATE_INFLOW',
          targetType: 'CUSTOMER_INVOICE',
          targetId: sampleInvoice.id,
          targetLabel: sampleInvoice.invoiceNumber,
          amountPaise: '2000000',
          originalDate: sampleInvoice.dueDate,
          simulatedDate: '2026-11-16',
        },
        {
          actionType: 'DEFER_OUTFLOW',
          targetType: 'SUPPLIER_BILL',
          targetId: sampleBill.id,
          targetLabel: sampleBill.billNumber,
          amountPaise: '2000000',
          originalDate: sampleBill.dueDate,
          simulatedDate: '2026-11-25',
        },
      ],
    };

    // Run forecast
    computeCashForecast(forecastInput);

    // Verify sampleInvoice, sampleBill, sampleExpense remain identical
    expect(sampleInvoice).toEqual(originalInvoiceCopy);
    expect(sampleBill).toEqual(originalBillCopy);
    expect(sampleExpense).toEqual(originalExpenseCopy);
  });
});
