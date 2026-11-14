import { addDays } from './dates.js';
import { parsePaise } from './money.js';
import type { CustomerInvoiceDTO, SupplierBillDTO } from './types.js';
import type { ScenarioActionInput } from './forecast.js';
import type { ResolutionPlan, ResolutionActionCandidate } from './resolution.js';

export type ScenarioIntentResult =
  | {
      type: 'RESOLVED';
      title: string;
      subtitle: string;
      actions: ScenarioActionInput[];
      explanation: string;
    }
  | {
      type: 'AMBIGUOUS';
      category: 'DELAY_RETAILER' | 'DEFER_SUPPLIER' | 'CHOOSE_RESOLUTION';
      message: string;
      suggestedDays?: number;
      candidateInvoices?: CustomerInvoiceDTO[];
      candidateBills?: SupplierBillDTO[];
      candidatePlans?: ResolutionPlan[];
    }
  | {
      type: 'UNKNOWN';
      message: string;
    };

export interface ParseScenarioIntentContext {
  invoices: CustomerInvoiceDTO[];
  bills: SupplierBillDTO[];
  asOfDate: string;
  feasiblePlans?: ResolutionPlan[];
}

/**
 * Parses natural-language scenario requests.
 * If details (like retailer or days) are ambiguous or missing, returns AMBIGUOUS
 * requesting clarification rather than inventing fake parameters.
 */
export function parseScenarioIntent(
  query: string,
  context: ParseScenarioIntentContext,
): ScenarioIntentResult {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      type: 'UNKNOWN',
      message: 'Please enter a scenario request, e.g., "What if this retailer pays late?" or "Simulate a 20% collection drop".',
    };
  }

  // 1. "What happens if I choose this resolution?" / "Test this resolution"
  if (
    q.includes('choose this resolution') ||
    q.includes('this resolution') ||
    q.includes('apply this plan') ||
    q.includes('recommended plan') ||
    q.includes('recommendation')
  ) {
    if (!context.feasiblePlans || context.feasiblePlans.length === 0) {
      return {
        type: 'UNKNOWN',
        message: 'No feasible resolution plans are currently available to test.',
      };
    }

    if (context.feasiblePlans.length === 1) {
      const plan = context.feasiblePlans[0];
      return {
        type: 'RESOLVED',
        title: `Simulated Resolution: ${plan.label}`,
        subtitle: 'Transferred directly from Resolution Autopilot recommended plan',
        actions: plan.actions.map((a: ResolutionActionCandidate) => a.scenarioAction),
        explanation: `Simulates ${plan.actions.length} action(s) from recommended plan: ${plan.actions
          .map((a: ResolutionActionCandidate) => `${a.targetCode} (${a.counterpartyName})`)
          .join(', ')}.`,
      };
    }

    return {
      type: 'AMBIGUOUS',
      category: 'CHOOSE_RESOLUTION',
      message: 'Multiple feasible resolution plans are available. Which plan would you like to test in What-If?',
      candidatePlans: context.feasiblePlans,
    };
  }

  // 2. Collection drop percentage: e.g. "Simulate a 20% collection drop" / "drop 15%"
  if (q.includes('drop') || q.includes('collection drop') || (q.includes('fall') && q.includes('collection'))) {
    const pctMatch = q.match(/(\d+)\s*%/);
    const pct = pctMatch ? parseInt(pctMatch[1], 10) : 20;

    const boundedPct = Math.min(100, Math.max(1, pct));
    return {
      type: 'RESOLVED',
      title: `Shockwave: ${boundedPct}% Market Collection Drop`,
      subtitle: `Simulates a synthetic ${boundedPct}% decrease across all uncollected customer receivables`,
      actions: [
        {
          id: `shock-drop-${boundedPct}pct`,
          targetType: 'SYNTHETIC_ADJUSTMENT',
          targetId: null,
          targetLabel: `${boundedPct}% Market Collection Drop Shockwave`,
          actionType: 'DROP_INFLOW_PCT',
          amountPaise: boundedPct.toString(),
          originalDate: null,
          simulatedDate: context.asOfDate,
        },
      ],
      explanation: `Stress-tests business liquidity by discounting all projected inflows by ${boundedPct}%.`,
    };
  }

  // Check for supplier keywords or supplier entity mentions first
  const hasSupplierKeyword =
    q.includes('supplier') ||
    q.includes('vendor') ||
    q.includes('bill') ||
    q.includes('defer') ||
    context.bills.some((b) => {
      const supName = (b.supplierName || '').toLowerCase();
      const supCode = (b.supplierCode || '').toLowerCase();
      const billNum = (b.billNumber || '').toLowerCase();
      if (supCode && q.includes(supCode)) return true;
      if (billNum && q.includes(billNum)) return true;
      const words = supName.split(/\s+/).filter((w) => w.length >= 4);
      return words.some((w) => q.includes(w));
    });

  // 3. Supplier bill delay / deferral: e.g. "What if I delay this supplier payment?", "What if I delay Apex bill by 7 days?"
  if (hasSupplierKeyword && (q.includes('delay') || q.includes('defer') || q.includes('late') || q.includes('shift') || q.includes('push'))) {
    const openBills = context.bills.filter(
      (b) =>
        b.status !== 'PAID' &&
        b.status !== 'CANCELLED' &&
        parsePaise(b.outstandingPaise) > 0n,
    );

    if (openBills.length === 0) {
      return {
        type: 'UNKNOWN',
        message: 'No open supplier bills available in current records to simulate payment deferrals.',
      };
    }

    const daysMatch = q.match(/(\d+)\s*(?:day|days)/);
    const parsedDays = daysMatch ? parseInt(daysMatch[1], 10) : undefined;

    const matchedBill = openBills.find((b) => {
      const supName = (b.supplierName || '').toLowerCase();
      const supCode = (b.supplierCode || '').toLowerCase();
      const billNum = (b.billNumber || '').toLowerCase();
      if (supCode && q.includes(supCode)) return true;
      if (billNum && q.includes(billNum)) return true;
      const words = supName.split(/\s+/).filter((w) => w.length >= 4);
      return words.some((w) => q.includes(w));
    });

    if (matchedBill && parsedDays) {
      const simulatedDate = addDays(matchedBill.dueDate, parsedDays);
      return {
        type: 'RESOLVED',
        title: `What-If: ${matchedBill.supplierName ?? matchedBill.supplierCode} Deferred ${parsedDays} Days`,
        subtitle: `Bill ${matchedBill.billNumber} shifted from ${matchedBill.dueDate} to ${simulatedDate}`,
        actions: [
          {
            id: `whatif-defer-${matchedBill.id}`,
            targetType: 'SUPPLIER_BILL',
            targetId: matchedBill.id,
            targetLabel: `${matchedBill.billNumber} (${matchedBill.supplierName ?? 'Supplier'}) Deferred ${parsedDays}D`,
            actionType: 'DEFER_OUTFLOW',
            amountPaise: matchedBill.outstandingPaise,
            originalDate: matchedBill.dueDate,
            simulatedDate,
          },
        ],
        explanation: `Simulates deferring supplier bill ${matchedBill.billNumber} by ${parsedDays} days to preserve operating liquidity.`,
      };
    }

    return {
      type: 'AMBIGUOUS',
      category: 'DEFER_SUPPLIER',
      message: matchedBill
        ? `Supplier "${matchedBill.supplierName}" matched. How many days deferral would you like to test?`
        : 'Which supplier bill would you like to defer, and by how many days?',
      suggestedDays: parsedDays || 7,
      candidateBills: openBills,
    };
  }

  // 4. Retailer payment delay: e.g. "What if this retailer pays late?", "What if Suresh pays 5 days late?"
  const isRetailerDelay =
    (q.includes('late') && (q.includes('pay') || q.includes('pays') || q.includes('settl'))) ||
    q.includes('delay') ||
    q.includes('retailer') ||
    q.includes('customer') ||
    q.includes('invoice');

  if (isRetailerDelay) {
    const openInvoices = context.invoices.filter(
      (inv) =>
        inv.status !== 'PAID' &&
        inv.status !== 'CANCELLED' &&
        inv.status !== 'WRITTEN_OFF' &&
        parsePaise(inv.outstandingPaise) > 0n,
    );

    if (openInvoices.length === 0) {
      return {
        type: 'UNKNOWN',
        message: 'No open customer invoices available in current business records to simulate payment delays.',
      };
    }

    const daysMatch = q.match(/(\d+)\s*(?:day|days)/);
    const parsedDays = daysMatch ? parseInt(daysMatch[1], 10) : undefined;

    const matchedInvoice = openInvoices.find((inv) => {
      const retName = (inv.retailerName || '').toLowerCase();
      const retCode = (inv.retailerCode || '').toLowerCase();
      const invNum = (inv.invoiceNumber || '').toLowerCase();
      if (retCode && q.includes(retCode)) return true;
      if (invNum && q.includes(invNum)) return true;
      const words = retName.split(/\s+/).filter((w) => w.length >= 4);
      return words.some((w) => q.includes(w));
    });

    if (matchedInvoice && parsedDays) {
      const simulatedDate = addDays(matchedInvoice.dueDate, parsedDays);
      return {
        type: 'RESOLVED',
        title: `What-If: ${matchedInvoice.retailerName ?? matchedInvoice.retailerCode} Delayed ${parsedDays} Days`,
        subtitle: `Invoice ${matchedInvoice.invoiceNumber} shifted from ${matchedInvoice.dueDate} to ${simulatedDate}`,
        actions: [
          {
            id: `whatif-delay-${matchedInvoice.id}`,
            targetType: 'CUSTOMER_INVOICE',
            targetId: matchedInvoice.id,
            targetLabel: `${matchedInvoice.invoiceNumber} (${matchedInvoice.retailerName ?? 'Retailer'}) Delayed ${parsedDays}D`,
            actionType: 'DELAY_INFLOW',
            amountPaise: matchedInvoice.outstandingPaise,
            originalDate: matchedInvoice.dueDate,
            simulatedDate,
          },
        ],
        explanation: `Simulates customer ${matchedInvoice.retailerName ?? matchedInvoice.retailerCode} delaying settlement of ${matchedInvoice.invoiceNumber} by ${parsedDays} days.`,
      };
    }

    return {
      type: 'AMBIGUOUS',
      category: 'DELAY_RETAILER',
      message: matchedInvoice
        ? `Customer "${matchedInvoice.retailerName}" matched. How many days payment delay would you like to simulate?`
        : 'Which retailer invoice would you like to simulate delaying, and by how many days?',
      suggestedDays: parsedDays || 5,
      candidateInvoices: openInvoices,
    };
  }

  return {
    type: 'UNKNOWN',
    message:
      'Unrecognized scenario intent. Try asking: "What if this retailer pays late?", "What if I delay this supplier payment?", "Simulate a 20% collection drop", or "What happens if I choose this resolution?".',
  };
}
