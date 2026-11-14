import { describe, expect, it } from 'vitest';
import {
  parseScenarioIntent,
  type CustomerInvoiceDTO,
  type ParseScenarioIntentContext,
  type ResolutionPlan,
  type SupplierBillDTO,
} from '../index.js';

describe('Natural Language Scenario Intent Parser', () => {
  const asOfDate = '2026-11-14';

  const mockInvoices: CustomerInvoiceDTO[] = [
    {
      id: 'inv-1',
      businessId: 'biz-1',
      retailerId: 'ret-1',
      retailerCode: 'RET-01',
      retailerName: 'Suresh Patel Supermarket',
      invoiceNumber: 'INV-1001',
      invoiceDate: '2026-11-01',
      dueDate: '2026-11-18',
      totalAmountPaise: '5000000',
      paidAmountPaise: '0',
      outstandingPaise: '5000000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED_PROMISE',
      externalReference: null,
      recordOrigin: 'MANUAL_ENTRY',
      notes: null,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'inv-2',
      businessId: 'biz-1',
      retailerId: 'ret-2',
      retailerCode: 'RET-02',
      retailerName: 'Krishna Mart',
      invoiceNumber: 'INV-1002',
      invoiceDate: '2026-11-02',
      dueDate: '2026-11-20',
      totalAmountPaise: '3000000',
      paidAmountPaise: '0',
      outstandingPaise: '3000000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED_PROMISE',
      externalReference: null,
      recordOrigin: 'MANUAL_ENTRY',
      notes: null,
      createdAt: '2026-11-02T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z',
    },
  ];

  const mockBills: SupplierBillDTO[] = [
    {
      id: 'bill-1',
      businessId: 'biz-1',
      supplierId: 'sup-1',
      supplierCode: 'SUP-01',
      supplierName: 'Apex Consumer Goods',
      billNumber: 'BILL-APX-8821',
      issueDate: '2026-11-05',
      dueDate: '2026-11-19',
      totalAmountPaise: '15000000',
      paidAmountPaise: '0',
      outstandingPaise: '15000000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED',
      priorityTier: 'NORMAL',
      recordOrigin: 'MANUAL_ENTRY',
      notes: null,
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    },
  ];

  const mockPlan: ResolutionPlan = {
    planId: 'plan-1',
    label: 'Balanced Liquidity Bridge',
    feasible: true,
    withinApprovedLimits: true,
    actions: [
      {
        id: 'act-1',
        targetType: 'CUSTOMER_INVOICE',
        targetId: 'inv-1',
        targetCode: 'INV-1001',
        counterpartyName: 'Suresh Patel Supermarket',
        actionType: 'ACCELERATE_INFLOW',
        amountPaise: '4000000',
        originalDate: '2026-11-18',
        proposedDate: '2026-11-16',
        withinApprovedLimits: true,
        limitExplanation: 'Within 80% limit',
        scenarioAction: {
          id: 'sc-1',
          targetType: 'CUSTOMER_INVOICE',
          targetId: 'inv-1',
          targetLabel: 'INV-1001 Early',
          actionType: 'ACCELERATE_INFLOW',
          amountPaise: '4000000',
          originalDate: '2026-11-18',
          simulatedDate: '2026-11-16',
        },
      },
    ],
    forecast: {} as any,
    postActionLowestBalancePaise: '1500000',
    totalCashShiftedPaise: '4000000',
    deferralBurdenPaise: '0',
    fragilityScore: 1,
    humanApprovalNote: 'Approval needed',
  };

  const context: ParseScenarioIntentContext = {
    invoices: mockInvoices,
    bills: mockBills,
    asOfDate,
    feasiblePlans: [mockPlan],
  };

  it('detects ambiguous retailer delay request and asks for missing parameters', () => {
    const res = parseScenarioIntent('What if this retailer pays late?', context);
    expect(res.type).toBe('AMBIGUOUS');
    if (res.type === 'AMBIGUOUS') {
      expect(res.category).toBe('DELAY_RETAILER');
      expect(res.candidateInvoices).toHaveLength(2);
      expect(res.suggestedDays).toBe(5);
    }
  });

  it('resolves explicit retailer payment delay request', () => {
    const res = parseScenarioIntent('What if Suresh Patel pays 5 days late?', context);
    expect(res.type).toBe('RESOLVED');
    if (res.type === 'RESOLVED') {
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0].actionType).toBe('DELAY_INFLOW');
      expect(res.actions[0].targetId).toBe('inv-1');
      expect(res.actions[0].simulatedDate).toBe('2026-11-23'); // 2026-11-18 + 5 days
    }
  });

  it('detects ambiguous supplier deferral request', () => {
    const res = parseScenarioIntent('What if I delay this supplier payment?', context);
    expect(res.type).toBe('AMBIGUOUS');
    if (res.type === 'AMBIGUOUS') {
      expect(res.category).toBe('DEFER_SUPPLIER');
      expect(res.candidateBills).toHaveLength(1);
    }
  });

  it('resolves explicit supplier deferral request', () => {
    const res = parseScenarioIntent('What if I delay Apex bill by 7 days?', context);
    expect(res.type).toBe('RESOLVED');
    if (res.type === 'RESOLVED') {
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0].actionType).toBe('DEFER_OUTFLOW');
      expect(res.actions[0].targetId).toBe('bill-1');
      expect(res.actions[0].simulatedDate).toBe('2026-11-26'); // 2026-11-19 + 7 days
    }
  });

  it('resolves collection drop percentage shockwave', () => {
    const res = parseScenarioIntent('Simulate a 20% collection drop.', context);
    expect(res.type).toBe('RESOLVED');
    if (res.type === 'RESOLVED') {
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0].actionType).toBe('DROP_INFLOW_PCT');
      expect(res.actions[0].amountPaise).toBe('20');
      expect(res.actions[0].simulatedDate).toBe(asOfDate);
    }
  });

  it('resolves "What happens if I choose this resolution?" when plan exists', () => {
    const res = parseScenarioIntent('What happens if I choose this resolution?', context);
    expect(res.type).toBe('RESOLVED');
    if (res.type === 'RESOLVED') {
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0].id).toBe('sc-1');
    }
  });

  it('handles unknown or empty queries gracefully', () => {
    const emptyRes = parseScenarioIntent('', context);
    expect(emptyRes.type).toBe('UNKNOWN');

    const unknownRes = parseScenarioIntent('Can you make me a coffee?', context);
    expect(unknownRes.type).toBe('UNKNOWN');
  });
});
