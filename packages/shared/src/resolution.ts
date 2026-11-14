import { addDays, compareIsoDate, diffDays, type IsoDate } from './dates.js';
import { computeCashForecast, type ForecastInput, type ScenarioActionInput } from './forecast.js';
import { minPaise, parsePaise, paiseToString, percentageOfPaise } from './money.js';
import type { ApprovalLimits, ForecastResult } from './types.js';

export interface ResolutionActionCandidate {
  id: string;
  targetType: 'CUSTOMER_INVOICE' | 'SUPPLIER_BILL' | 'OPERATING_EXPENSE';
  targetId: string;
  targetCode: string;
  counterpartyName: string;
  actionType: 'ACCELERATE_INFLOW' | 'DEFER_OUTFLOW';
  amountPaise: string;
  originalDate: IsoDate;
  proposedDate: IsoDate;
  withinApprovedLimits: boolean;
  limitExplanation: string;
  scenarioAction: ScenarioActionInput;
}

export interface ResolutionPlan {
  planId: string;
  label: string;
  feasible: boolean;
  withinApprovedLimits: boolean;
  actions: ResolutionActionCandidate[];
  forecast: ForecastResult;
  postActionLowestBalancePaise: string;
  totalCashShiftedPaise: string;
  deferralBurdenPaise: string;
  fragilityScore: number;
  humanApprovalNote: string;
}

export interface SurvivalPriorityItem {
  rank: number;
  itemType: 'OPERATING_EXPENSE' | 'SUPPLIER_BILL';
  id: string;
  referenceCode: string;
  description: string;
  dueDate: IsoDate;
  amountPaise: string;
  priorityTier: string;
  isProtected: boolean;
  recommendation: 'PAY_ON_TIME' | 'NEGOTIATE_DEFERRAL' | 'PARTIAL_PAY_ONLY';
}

export interface EmergencyLever {
  rank: number;
  leverType: 'CUSTOMER_PARTIAL_PAYMENT' | 'EXTEND_SUPPLIER_DEFERRAL' | 'DEFER_NONCRITICAL_EXPENSE' | 'OWNER_TOP_UP_MANUAL';
  title: string;
  targetAmountPaise: string;
  rationale: string;
  requiresHumanExecution: true;
}

export interface ResolutionSearchResult {
  status: 'FEASIBLE_PLANS_FOUND' | 'NO_BREACH' | 'NO_FEASIBLE_PLAN';
  totalCombinationsEvaluated: number;
  withinLimitsCombinationsCount: number;
  feasiblePlansCount: number;
  gridDimensions: {
    earlyReceiptChoices: number;
    supplierDeferralChoices: number;
    expenseDeferralChoices: number;
  };
  baselineForecast: ForecastResult;
  feasiblePlans: ResolutionPlan[];
  bestPartialPlan: ResolutionPlan | null;
  candidateActions: ResolutionActionCandidate[];
  survivalModePriorities: SurvivalPriorityItem[];
  emergencyLevers: EmergencyLever[];
  emergencySummary: string | null;
}

function roundToNearest5000Rupees(paise: bigint): bigint {
  const step = 500_000n; // ₹5,000 in paise
  return ((paise + step / 2n) / step) * step;
}

function buildSupplierDeferralGridAmounts(capPaise: bigint): bigint[] {
  if (capPaise <= 0n) {
    return [0n, 0n, 0n, 0n, 0n];
  }
  if (capPaise >= 2_000_000n) {
    // 5 discrete steps covering 0%, ~25%, ~50%, ~66% (₹25k on ₹38k cap), and 100% cap
    const step1 = roundToNearest5000Rupees((capPaise * 25n) / 100n);
    const step2 = roundToNearest5000Rupees((capPaise * 50n) / 100n);
    const step3 = roundToNearest5000Rupees((capPaise * 66n) / 100n);
    return [0n, step1, step2, step3, capPaise];
  }
  return [
    0n,
    (capPaise * 25n) / 100n,
    (capPaise * 50n) / 100n,
    (capPaise * 75n) / 100n,
    capPaise,
  ];
}

export function searchBoundedResolutions(
  input: ForecastInput,
  limits: ApprovalLimits,
  supplierConstraints: Map<string, { maxDeferralDays: number; maxDeferralPct: number; isCritical: boolean }>,
): ResolutionSearchResult {
  const baseline = computeCashForecast({ ...input, scenarioActions: [] });

  const survivalPriorities: SurvivalPriorityItem[] = [
    ...input.expenses
      .filter((e) => e.status !== 'PAID' && e.status !== 'CANCELLED')
      .map((e) => ({
        rank: e.isProtected || e.priorityTier === 'ESSENTIAL' ? 1 : 3,
        itemType: 'OPERATING_EXPENSE' as const,
        id: e.id,
        referenceCode: e.expenseCode,
        description: `${e.category}: ${e.description}`,
        dueDate: e.dueDate,
        amountPaise: e.outstandingPaise,
        priorityTier: e.priorityTier,
        isProtected: e.isProtected,
        recommendation: (e.isProtected || e.priorityTier === 'ESSENTIAL'
          ? 'PAY_ON_TIME'
          : 'NEGOTIATE_DEFERRAL') as SurvivalPriorityItem['recommendation'],
      })),
    ...input.bills
      .filter((b) => b.status !== 'PAID' && b.status !== 'CANCELLED')
      .map((b) => {
        const sup = supplierConstraints.get(b.supplierId);
        const isCritical = sup?.isCritical ?? b.priorityTier === 'ESSENTIAL';
        return {
          rank: isCritical ? 2 : 4,
          itemType: 'SUPPLIER_BILL' as const,
          id: b.id,
          referenceCode: b.billNumber,
          description: `${b.supplierName ?? 'Supplier'} (${b.billNumber})`,
          dueDate: b.dueDate,
          amountPaise: b.outstandingPaise,
          priorityTier: b.priorityTier,
          isProtected: isCritical,
          recommendation: (isCritical ? 'PAY_ON_TIME' : 'NEGOTIATE_DEFERRAL') as SurvivalPriorityItem['recommendation'],
        };
      }),
  ].sort((a, b) => a.rank - b.rank || a.dueDate.localeCompare(b.dueDate));

  if (baseline.breach.firstBreachDate === null) {
    return {
      status: 'NO_BREACH',
      totalCombinationsEvaluated: 0,
      withinLimitsCombinationsCount: 0,
      feasiblePlansCount: 0,
      gridDimensions: {
        earlyReceiptChoices: 0,
        supplierDeferralChoices: 0,
        expenseDeferralChoices: 0,
      },
      baselineForecast: baseline,
      feasiblePlans: [],
      bestPartialPlan: null,
      candidateActions: [],
      survivalModePriorities: survivalPriorities,
      emergencyLevers: [],
      emergencySummary: null,
    };
  }

  const breachDate = baseline.breach.firstBreachDate;
  const horizonEnd = addDays(input.asOfDate, input.horizonDays);
  const candidateActions: ResolutionActionCandidate[] = [];

  // Select primary eligible early-receipt invoice (due after breach within maxEarlyDays)
  const eligibleEarlyInvoices = input.invoices
    .filter((inv) => {
      if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') return false;
      if (compareIsoDate(inv.dueDate, breachDate) <= 0) return false;
      if (parsePaise(inv.outstandingPaise) <= 0n) return false;
      return diffDays(breachDate, inv.dueDate) <= limits.maxEarlyDays;
    })
    .sort((a, b) => {
      const rankEv = (s: string) => (s === 'CONFIRMED_PROMISE' ? 0 : s === 'UNCONFIRMED' ? 1 : 2);
      const evDiff = rankEv(a.evidenceStatus) - rankEv(b.evidenceStatus);
      if (evDiff !== 0) return evDiff;
      const amtA = parsePaise(a.outstandingPaise);
      const amtB = parsePaise(b.outstandingPaise);
      return amtA > amtB ? -1 : amtA < amtB ? 1 : a.dueDate.localeCompare(b.dueDate);
    });

  // Select primary supplier bill due on/before breach (non-critical if possible)
  const eligibleSupplierBills = input.bills
    .filter((b) => {
      if (b.status === 'PAID' || b.status === 'CANCELLED') return false;
      if (compareIsoDate(b.dueDate, breachDate) > 0) return false;
      return parsePaise(b.outstandingPaise) > 0n;
    })
    .sort((a, b) => {
      const rankEv = (s: string) => (s === 'CONFIRMED_PROMISE' ? 0 : s === 'UNCONFIRMED' ? 1 : 2);
      const evDiff = rankEv(a.evidenceStatus) - rankEv(b.evidenceStatus);
      if (evDiff !== 0) return evDiff;
      const amtA = parsePaise(a.outstandingPaise);
      const amtB = parsePaise(b.outstandingPaise);
      return amtA > amtB ? -1 : amtA < amtB ? 1 : a.dueDate.localeCompare(b.dueDate);
    });

  // Select primary operating expense due on/before breach
  const eligibleExpenses = input.expenses
    .filter((e) => {
      if (e.status === 'PAID' || e.status === 'CANCELLED') return false;
      if (compareIsoDate(e.dueDate, breachDate) > 0) return false;
      return parsePaise(e.outstandingPaise) > 0n;
    })
    .sort((a, b) => {
      if (a.isProtected !== b.isProtected) return a.isProtected ? 1 : -1;
      const amtA = parsePaise(a.outstandingPaise);
      const amtB = parsePaise(b.outstandingPaise);
      return amtA > amtB ? -1 : amtA < amtB ? 1 : 0;
    });

  // Build 3 discrete early-receipt choices
  const primaryInv = eligibleEarlyInvoices[0] ?? null;
  const earlyOptions: Array<ResolutionActionCandidate | null> = [null];
  if (primaryInv) {
    const out = parsePaise(primaryInv.outstandingPaise);
    const maxEarlyCap = percentageOfPaise(out, limits.maxEarlyRequestPct);
    const targetDate =
      compareIsoDate(breachDate, input.asOfDate) > 0 ? addDays(breachDate, -1) : input.asOfDate;

    const halfAmt = maxEarlyCap / 2n;
    const amounts = [halfAmt, maxEarlyCap];
    amounts.forEach((amt, idx) => {
      if (amt <= 0n) {
        earlyOptions.push(null);
        return;
      }
      const cid = `cand-early-${primaryInv.id}-${idx + 1}`;
      const cand: ResolutionActionCandidate = {
        id: cid,
        targetType: 'CUSTOMER_INVOICE',
        targetId: primaryInv.id,
        targetCode: primaryInv.invoiceNumber,
        counterpartyName: primaryInv.retailerName ?? primaryInv.retailerCode ?? 'Customer',
        actionType: 'ACCELERATE_INFLOW',
        amountPaise: paiseToString(amt),
        originalDate: primaryInv.dueDate,
        proposedDate: targetDate,
        withinApprovedLimits: true,
        limitExplanation: `Early receipt <= ${limits.maxEarlyRequestPct}% (due ${primaryInv.dueDate} -> ${targetDate})`,
        scenarioAction: {
          id: cid,
          targetType: 'CUSTOMER_INVOICE',
          targetId: primaryInv.id,
          targetLabel: `${primaryInv.invoiceNumber} (${primaryInv.retailerName ?? 'Customer'})`,
          actionType: 'ACCELERATE_INFLOW',
          amountPaise: paiseToString(amt),
          originalDate: primaryInv.dueDate,
          simulatedDate: targetDate,
        },
      };
      earlyOptions.push(cand);
      candidateActions.push(cand);
    });
  } else {
    earlyOptions.push(null, null);
  }

  // Build 5 discrete supplier-deferral choices
  const primaryBill = eligibleSupplierBills[0] ?? null;
  const supplierOptions: Array<ResolutionActionCandidate | null> = [];
  if (primaryBill) {
    const sup = supplierConstraints.get(primaryBill.supplierId);
    const isCritical = Boolean(sup?.isCritical || primaryBill.priorityTier === 'ESSENTIAL');
    const maxPct = isCritical
      ? 0
      : Math.min(sup?.maxDeferralPct ?? limits.defaultMaxSupplierDeferralPct, limits.defaultMaxSupplierDeferralPct);
    const maxDays = isCritical
      ? 0
      : Math.min(sup?.maxDeferralDays ?? limits.defaultMaxSupplierDeferralDays, limits.defaultMaxSupplierDeferralDays);
    const billOut = parsePaise(primaryBill.outstandingPaise);
    const cap = percentageOfPaise(billOut, maxPct);
    const rawDate = addDays(primaryBill.dueDate, Math.min(7, Math.max(1, maxDays)));
    const proposedDate = compareIsoDate(rawDate, horizonEnd) > 0 ? horizonEnd : rawDate;
    const gridAmts = buildSupplierDeferralGridAmounts(cap);

    gridAmts.forEach((amt, idx) => {
      if (amt <= 0n || maxDays <= 0 || isCritical) {
        supplierOptions.push(null);
        return;
      }
      const cid = `cand-defer-bill-${primaryBill.id}-${idx}`;
      const cand: ResolutionActionCandidate = {
        id: cid,
        targetType: 'SUPPLIER_BILL',
        targetId: primaryBill.id,
        targetCode: primaryBill.billNumber,
        counterpartyName: primaryBill.supplierName ?? primaryBill.supplierCode ?? 'Supplier',
        actionType: 'DEFER_OUTFLOW',
        amountPaise: paiseToString(amt),
        originalDate: primaryBill.dueDate,
        proposedDate,
        withinApprovedLimits: true,
        limitExplanation: `Defer <= ${maxPct}% for <= ${maxDays}d (${primaryBill.dueDate} -> ${proposedDate})`,
        scenarioAction: {
          id: cid,
          targetType: 'SUPPLIER_BILL',
          targetId: primaryBill.id,
          targetLabel: `${primaryBill.billNumber} (${primaryBill.supplierName ?? 'Supplier'})`,
          actionType: 'DEFER_OUTFLOW',
          amountPaise: paiseToString(amt),
          originalDate: primaryBill.dueDate,
          simulatedDate: proposedDate,
        },
      };
      supplierOptions.push(cand);
      candidateActions.push(cand);
    });
  } else {
    supplierOptions.push(null, null, null, null, null);
  }

  // Build 2 discrete expense-deferral choices (No deferral vs Defer 50% if non-protected)
  const primaryExp = eligibleExpenses[0] ?? null;
  const expenseOptions: Array<ResolutionActionCandidate | null> = [null];
  if (primaryExp) {
    const firewallBlocked =
      (primaryExp.isProtected && limits.protectEssentialExpenses) ||
      primaryExp.priorityTier === 'ESSENTIAL';
    const deferAmt = percentageOfPaise(parsePaise(primaryExp.outstandingPaise), 50);
    const proposedDate = addDays(primaryExp.dueDate, 5);
    const cid = `cand-defer-exp-${primaryExp.id}`;
    const expCand: ResolutionActionCandidate = {
      id: cid,
      targetType: 'OPERATING_EXPENSE',
      targetId: primaryExp.id,
      targetCode: primaryExp.expenseCode,
      counterpartyName: primaryExp.description,
      actionType: 'DEFER_OUTFLOW',
      amountPaise: paiseToString(deferAmt),
      originalDate: primaryExp.dueDate,
      proposedDate: compareIsoDate(proposedDate, horizonEnd) > 0 ? horizonEnd : proposedDate,
      withinApprovedLimits: !firewallBlocked,
      limitExplanation: firewallBlocked
        ? 'Blocked by Liquidity Firewall (essential/protected operating expense)'
        : 'Non-protected expense deferral (50% for 5d)',
      scenarioAction: {
        id: cid,
        targetType: 'OPERATING_EXPENSE',
        targetId: primaryExp.id,
        targetLabel: `${primaryExp.expenseCode} (${primaryExp.description})`,
        actionType: 'DEFER_OUTFLOW',
        amountPaise: paiseToString(deferAmt),
        originalDate: primaryExp.dueDate,
        simulatedDate: compareIsoDate(proposedDate, horizonEnd) > 0 ? horizonEnd : proposedDate,
      },
    };
    expenseOptions.push(expCand);
    if (!firewallBlocked) {
      candidateActions.push(expCand);
    }
  } else {
    expenseOptions.push(null);
  }

  // Enumerate all 3 x 5 x 2 = 30 combinations and run true cash-flow forecast on each
  const evaluatedPlans: ResolutionPlan[] = [];
  const seenActionSignatures = new Set<string>();
  let totalCombinationsEvaluated = 0;
  let withinLimitsCombinationsCount = 0;

  for (const early of earlyOptions) {
    for (const sup of supplierOptions) {
      for (const exp of expenseOptions) {
        totalCombinationsEvaluated += 1;
        const actions = [early, sup, exp].filter((x): x is ResolutionActionCandidate => x !== null);
        const withinLimits =
          actions.length > 0 &&
          actions.length <= limits.maxActionsPerPlan &&
          actions.every((a) => a.withinApprovedLimits);

        if (withinLimits) {
          withinLimitsCombinationsCount += 1;
        }

        if (actions.length === 0) continue;

        const sig = actions
          .map((a) => `${a.targetId}:${a.actionType}:${a.amountPaise}:${a.proposedDate}`)
          .join('|');
        if (seenActionSignatures.has(sig)) continue;
        seenActionSignatures.add(sig);

        const forecast = computeCashForecast({
          ...input,
          scenarioActions: actions.map((a) => a.scenarioAction),
        });

        const shifted = actions.reduce((acc, a) => acc + parsePaise(a.amountPaise), 0n);
        const deferralBurden = actions
          .filter((a) => a.actionType === 'DEFER_OUTFLOW')
          .reduce((acc, a) => acc + parsePaise(a.amountPaise), 0n);
        const feasible = withinLimits && forecast.breach.firstBreachDate === null;

        // Fragility score: lower is stronger (counts unconfirmed inflows + multi-action dependency)
        const unconfirmedPenalty = forecast.trustCounters.unconfirmedExpectedCount * 10;
        const fragilityScore = actions.length * 15 + unconfirmedPenalty;

        evaluatedPlans.push({
          planId: `plan-${evaluatedPlans.length + 1}`,
          label: actions
            .map((a) => `${a.targetCode}: ${a.actionType === 'ACCELERATE_INFLOW' ? 'Early' : 'Defer'}`)
            .join(' + '),
          feasible,
          withinApprovedLimits: withinLimits,
          actions,
          forecast,
          postActionLowestBalancePaise: forecast.breach.lowestBalancePaise,
          totalCashShiftedPaise: paiseToString(shifted),
          deferralBurdenPaise: paiseToString(deferralBurden),
          fragilityScore,
          humanApprovalNote:
            'Proposal only — requires explicit human outreach and recorded counterparty reply before updating commitments.',
        });
      }
    }
  }

  const feasiblePlans = evaluatedPlans
    .filter((p) => p.feasible)
    .sort((a, b) => {
      // Rank by: fewer asks first, then lower deferral burden, then higher minimum buffer
      if (a.actions.length !== b.actions.length) return a.actions.length - b.actions.length;
      const defA = parsePaise(a.deferralBurdenPaise);
      const defB = parsePaise(b.deferralBurdenPaise);
      if (defA !== defB) return defA < defB ? -1 : 1;
      const lowA = parsePaise(a.postActionLowestBalancePaise);
      const lowB = parsePaise(b.postActionLowestBalancePaise);
      return lowA > lowB ? -1 : lowA < lowB ? 1 : 0;
    });

  if (feasiblePlans.length > 0) {
    return {
      status: 'FEASIBLE_PLANS_FOUND',
      totalCombinationsEvaluated,
      withinLimitsCombinationsCount,
      feasiblePlansCount: feasiblePlans.length,
      gridDimensions: {
        earlyReceiptChoices: earlyOptions.length,
        supplierDeferralChoices: supplierOptions.length,
        expenseDeferralChoices: expenseOptions.length,
      },
      baselineForecast: baseline,
      feasiblePlans: feasiblePlans.slice(0, 15),
      bestPartialPlan: null,
      candidateActions,
      survivalModePriorities: survivalPriorities,
      emergencyLevers: [],
      emergencySummary: null,
    };
  }

  const validWithinLimits = evaluatedPlans.filter((p) => p.withinApprovedLimits);
  const bestPartialPlan =
    validWithinLimits.sort((a, b) => {
      const lowA = parsePaise(a.postActionLowestBalancePaise);
      const lowB = parsePaise(b.postActionLowestBalancePaise);
      return lowA > lowB ? -1 : lowA < lowB ? 1 : 0;
    })[0] ?? null;

  const residualLowest = bestPartialPlan
    ? bestPartialPlan.postActionLowestBalancePaise
    : baseline.breach.lowestBalancePaise;
  const minCash = parsePaise(input.minimumCashPaise);
  const residualDeficit = minCash - minPaise(parsePaise(residualLowest), minCash);

  const emergencyLevers: EmergencyLever[] = [
    {
      rank: 1,
      leverType: 'CUSTOMER_PARTIAL_PAYMENT',
      title: 'Request customer partial payment / advance above standard early-request cap',
      targetAmountPaise: paiseToString(residualDeficit),
      rationale: 'Fastest non-debt inflow lever; negotiate split UPI/RTGS collection before breach date.',
      requiresHumanExecution: true,
    },
    {
      rank: 2,
      leverType: 'EXTEND_SUPPLIER_DEFERRAL',
      title: 'Extend supplier deferral limit (amount % or deferral days) on non-critical bills',
      targetAmountPaise: paiseToString(residualDeficit),
      rationale: 'Requires explicit supplier confirmation; preserves Liquidity Firewall on essential expenses.',
      requiresHumanExecution: true,
    },
    {
      rank: 3,
      leverType: 'DEFER_NONCRITICAL_EXPENSE',
      title: 'Defer non-critical operating expenses in Survival Mode priority order',
      targetAmountPaise: paiseToString(residualDeficit),
      rationale: 'Only non-protected expenses should be deferred; payroll/statutory items remain P1.',
      requiresHumanExecution: true,
    },
    {
      rank: 4,
      leverType: 'OWNER_TOP_UP_MANUAL',
      title: 'Manual owner liquidity injection / cash top-up (no automated lending)',
      targetAmountPaise: paiseToString(residualDeficit),
      rationale: 'Covers remaining cash gap when bounded counterparty negotiations cannot bridge timing.',
      requiresHumanExecution: true,
    },
  ];

  return {
    status: 'NO_FEASIBLE_PLAN',
    totalCombinationsEvaluated,
    withinLimitsCombinationsCount,
    feasiblePlansCount: 0,
    gridDimensions: {
      earlyReceiptChoices: earlyOptions.length,
      supplierDeferralChoices: supplierOptions.length,
      expenseDeferralChoices: expenseOptions.length,
    },
    baselineForecast: baseline,
    feasiblePlans: [],
    bestPartialPlan,
    candidateActions,
    survivalModePriorities: survivalPriorities,
    emergencyLevers,
    emergencySummary: `NO FEASIBLE PLAN WITHIN APPROVED LIMITS: Evaluated ${totalCombinationsEvaluated} combinations (${withinLimitsCombinationsCount} within policy limits). Residual minimum deficit is ${paiseToString(residualDeficit)} paise. Use Emergency Mode levers and Survival Mode priorities below.`,
  };
}

export interface ScenarioValidationContext {
  invoices: import('./types.js').CustomerInvoiceDTO[];
  bills: import('./types.js').SupplierBillDTO[];
  expenses: import('./types.js').OperatingExpenseDTO[];
  asOfDate: IsoDate;
  horizonDays?: number;
  limits?: ApprovalLimits;
}

export interface ScenarioValidationResult {
  valid: boolean;
  error?: string;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDateString(val?: string | null): val is IsoDate {
  if (!val || typeof val !== 'string' || !ISO_DATE_REGEX.test(val)) return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val;
}

export function validateScenarioActionInput(
  action: ScenarioActionInput,
  context: ScenarioValidationContext,
): ScenarioValidationResult {
  if (!action) {
    return { valid: false, error: 'Action definition is missing or null.' };
  }

  // 1. Action type & Target type correlation
  if (action.actionType === 'ACCELERATE_INFLOW' || action.actionType === 'DELAY_INFLOW') {
    if (action.targetType !== 'CUSTOMER_INVOICE') {
      return {
        valid: false,
        error: `Action ${action.actionType} requires targetType CUSTOMER_INVOICE, received ${action.targetType}.`,
      };
    }
  } else if (action.actionType === 'DEFER_OUTFLOW' || action.actionType === 'SPLIT_OUTFLOW') {
    if (action.targetType !== 'SUPPLIER_BILL' && action.targetType !== 'OPERATING_EXPENSE') {
      return {
        valid: false,
        error: `Action ${action.actionType} requires targetType SUPPLIER_BILL or OPERATING_EXPENSE, received ${action.targetType}.`,
      };
    }
  } else if (action.actionType === 'DROP_INFLOW_PCT') {
    if (action.targetType !== 'SYNTHETIC_ADJUSTMENT') {
      return {
        valid: false,
        error: `Action DROP_INFLOW_PCT requires targetType SYNTHETIC_ADJUSTMENT, received ${action.targetType}.`,
      };
    }
  }

  // 2. Target existence, status & outstanding balance checks
  if (action.targetType === 'CUSTOMER_INVOICE') {
    if (!action.targetId) {
      return { valid: false, error: 'Customer invoice action is missing targetId.' };
    }
    const inv = context.invoices.find((i) => i.id === action.targetId);
    if (!inv) {
      return { valid: false, error: `Customer invoice with ID "${action.targetId}" not found in current business records.` };
    }
    if (inv.status === 'PAID') {
      return { valid: false, error: `Customer invoice ${inv.invoiceNumber} is PAID and cannot be accelerated.` };
    }
    if (inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') {
      return { valid: false, error: `Invoice ${inv.invoiceNumber} is ${inv.status} and cannot be modified in a scenario.` };
    }
    const outstanding = parsePaise(inv.outstandingPaise);
    if (outstanding <= 0n) {
      return { valid: false, error: `Invoice ${inv.invoiceNumber} has zero outstanding balance.` };
    }
    const requestedAmt = parsePaise(action.amountPaise);
    if (requestedAmt <= 0n) {
      return { valid: false, error: `Action amount must be positive. Received ${action.amountPaise} paise.` };
    }
    if (requestedAmt > outstanding) {
      return {
        valid: false,
        error: `Action amount (${action.amountPaise} paise) exceeds invoice outstanding balance (${inv.outstandingPaise} paise).`,
      };
    }
    if (context.limits && typeof context.limits.maxEarlyRequestPct === 'number' && action.actionType === 'ACCELERATE_INFLOW') {
      const maxAllowed = percentageOfPaise(outstanding, context.limits.maxEarlyRequestPct);
      if (requestedAmt > maxAllowed) {
        return {
          valid: false,
          error: `Accelerated amount exceeds approved limit of ${context.limits.maxEarlyRequestPct}% (max ${maxAllowed} paise, requested ${requestedAmt} paise).`,
        };
      }
    }
  } else if (action.targetType === 'SUPPLIER_BILL') {
    if (!action.targetId) {
      return { valid: false, error: 'Supplier bill action is missing targetId.' };
    }
    const bill = context.bills.find((b) => b.id === action.targetId);
    if (!bill) {
      return { valid: false, error: `Supplier bill with ID "${action.targetId}" not found in current business records.` };
    }
    if (bill.status === 'PAID') {
      return { valid: false, error: `Supplier bill ${bill.billNumber} is PAID and cannot be deferred.` };
    }
    if (bill.status === 'CANCELLED') {
      return { valid: false, error: `Supplier bill ${bill.billNumber} is CANCELLED and cannot be deferred.` };
    }
    const outstanding = parsePaise(bill.outstandingPaise);
    if (outstanding <= 0n) {
      return { valid: false, error: `Supplier bill ${bill.billNumber} has zero outstanding balance.` };
    }
    const requestedAmt = parsePaise(action.amountPaise);
    if (requestedAmt <= 0n) {
      return { valid: false, error: `Action amount must be positive. Received ${action.amountPaise} paise.` };
    }
    if (requestedAmt > outstanding) {
      return {
        valid: false,
        error: `Deferral amount (${action.amountPaise} paise) exceeds bill outstanding balance (${bill.outstandingPaise} paise).`,
      };
    }
    if (context.limits && typeof context.limits.defaultMaxSupplierDeferralPct === 'number' && action.actionType === 'DEFER_OUTFLOW') {
      const maxAllowed = percentageOfPaise(outstanding, context.limits.defaultMaxSupplierDeferralPct);
      if (requestedAmt > maxAllowed) {
        return {
          valid: false,
          error: `Deferral amount exceeds approved limit of ${context.limits.defaultMaxSupplierDeferralPct}% (max ${maxAllowed} paise, requested ${requestedAmt} paise).`,
        };
      }
    }
  } else if (action.targetType === 'OPERATING_EXPENSE') {
    if (!action.targetId) {
      return { valid: false, error: 'Operating expense action is missing targetId.' };
    }
    const exp = context.expenses.find((e) => e.id === action.targetId);
    if (!exp) {
      return { valid: false, error: `Operating expense with ID "${action.targetId}" not found in current business records.` };
    }
    if (exp.status === 'PAID' || exp.status === 'CANCELLED') {
      return { valid: false, error: `Operating expense ${exp.expenseCode} is ${exp.status} and cannot be deferred.` };
    }
    if (context.limits?.protectEssentialExpenses && (exp.isProtected || exp.priorityTier === 'ESSENTIAL')) {
      return { valid: false, error: `Liquidity firewall protected: Essential expense ${exp.expenseCode} cannot be deferred.` };
    }
    const outstanding = parsePaise(exp.outstandingPaise);
    if (outstanding <= 0n) {
      return { valid: false, error: `Operating expense ${exp.expenseCode} has zero outstanding balance.` };
    }
    const requestedAmt = parsePaise(action.amountPaise);
    if (requestedAmt <= 0n) {
      return { valid: false, error: `Action amount must be positive. Received ${action.amountPaise} paise.` };
    }
    if (requestedAmt > outstanding) {
      return {
        valid: false,
        error: `Deferral amount (${action.amountPaise} paise) exceeds expense outstanding balance (${exp.outstandingPaise} paise).`,
      };
    }
  } else if (action.targetType === 'SYNTHETIC_ADJUSTMENT') {
    const pct = Number(action.amountPaise);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      return {
        valid: false,
        error: `Collection drop percentage must be between 0 and 100. Received "${action.amountPaise}".`,
      };
    }
  }

  // 3. Date validity checks
  if (!isValidIsoDateString(action.simulatedDate)) {
    return { valid: false, error: `Simulated date "${action.simulatedDate}" is not a valid ISO date (YYYY-MM-DD).` };
  }
  if (action.originalDate !== null && !isValidIsoDateString(action.originalDate)) {
    return { valid: false, error: `Original date "${action.originalDate}" is not a valid ISO date (YYYY-MM-DD).` };
  }

  if (action.actionType === 'ACCELERATE_INFLOW') {
    if (!action.originalDate) {
      return { valid: false, error: 'ACCELERATE_INFLOW action requires an originalDate.' };
    }
    if (compareIsoDate(action.simulatedDate, action.originalDate) >= 0) {
      return {
        valid: false,
        error: `Simulated accelerated date (${action.simulatedDate}) must be strictly earlier than original due date (${action.originalDate}).`,
      };
    }
    if (compareIsoDate(action.simulatedDate, context.asOfDate) < 0) {
      return {
        valid: false,
        error: `Simulated accelerated date (${action.simulatedDate}) cannot be before the forecast start date (${context.asOfDate}).`,
      };
    }
    if (context.limits && diffDays(action.simulatedDate, action.originalDate) > context.limits.maxEarlyDays) {
      return {
        valid: false,
        error: `Early window (${diffDays(action.simulatedDate, action.originalDate)} days) exceeds approved maximum of ${context.limits.maxEarlyDays} days.`,
      };
    }
  } else if (action.actionType === 'DELAY_INFLOW' || action.actionType === 'DEFER_OUTFLOW' || action.actionType === 'SPLIT_OUTFLOW') {
    if (action.originalDate && compareIsoDate(action.simulatedDate, action.originalDate) <= 0) {
      return {
        valid: false,
        error: `Simulated date (${action.simulatedDate}) must be strictly later than original date (${action.originalDate}) for ${action.actionType}.`,
      };
    }
  }

  if (context.horizonDays && context.horizonDays > 0) {
    const horizonEnd = addDays(context.asOfDate, context.horizonDays);
    if (action.actionType === 'ACCELERATE_INFLOW' && compareIsoDate(action.simulatedDate, horizonEnd) > 0) {
      return {
        valid: false,
        error: `Simulated date (${action.simulatedDate}) is outside the active forecast horizon (${horizonEnd}).`,
      };
    }
  }

  return { valid: true };
}

export function validateScenarioActions(
  actions: ScenarioActionInput[],
  context: ScenarioValidationContext,
): ScenarioValidationResult {
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return { valid: false, error: 'At least one scenario action is required.' };
  }
  for (let i = 0; i < actions.length; i += 1) {
    const res = validateScenarioActionInput(actions[i], context);
    if (!res.valid) {
      return { valid: false, error: `Action #${i + 1} (${actions[i].targetLabel ?? actions[i].actionType}): ${res.error}` };
    }
  }
  return { valid: true };
}
