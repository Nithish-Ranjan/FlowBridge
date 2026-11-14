import { addDays, compareIsoDate, dateRange, diffDays, parseIsoDate, type IsoDate } from './dates.js';
import { parsePaise, paiseToString } from './money.js';
import type {
  BreachDiagnostic,
  ChasePriorityItem,
  CommitmentDTO,
  CustomerInvoiceDTO,
  DataClassification,
  ForecastDayEntry,
  ForecastItemTrace,
  ForecastResult,
  OperatingExpenseDTO,
  PaymentTransactionDTO,
  SupplierBillDTO,
  TrustScoreCounters,
} from './types.js';

export interface ScenarioActionInput {
  id?: string;
  targetType: 'CUSTOMER_INVOICE' | 'SUPPLIER_BILL' | 'OPERATING_EXPENSE' | 'SYNTHETIC_ADJUSTMENT';
  targetId: string | null;
  targetLabel: string;
  actionType: 'ACCELERATE_INFLOW' | 'DELAY_INFLOW' | 'DROP_INFLOW_PCT' | 'DEFER_OUTFLOW' | 'SPLIT_OUTFLOW';
  amountPaise: string;
  originalDate: IsoDate | null;
  simulatedDate: IsoDate;
}

export interface ForecastInput {
  businessId: string;
  asOfDate: IsoDate;
  horizonDays: number;
  openingCashPaise: string;
  minimumCashPaise: string;
  invoices: CustomerInvoiceDTO[];
  bills: SupplierBillDTO[];
  expenses: OperatingExpenseDTO[];
  commitments?: CommitmentDTO[];
  transactions?: PaymentTransactionDTO[];
  scenarioActions?: ScenarioActionInput[];
  includeUnconfirmedInflows?: boolean;
}

interface InternalItem {
  sourceType: ForecastItemTrace['sourceType'];
  sourceId: string;
  referenceCode: string;
  counterpartyName: string;
  direction: 'INFLOW' | 'OUTFLOW';
  amountPaise: bigint;
  classification: DataClassification;
  evidenceStatus: string;
  dueDate: IsoDate;
  note?: string;
}

function effectiveDateWithinHorizon(date: IsoDate, asOfDate: IsoDate, horizonEnd: IsoDate): IsoDate | null {
  if (compareIsoDate(date, horizonEnd) > 0) return null;
  // Overdue open items still due on/before asOfDate are recognized on Day 0 if unpaid
  if (compareIsoDate(date, asOfDate) < 0) return asOfDate;
  return date;
}

export function computeCashForecast(input: ForecastInput): ForecastResult {
  const asOfDate = parseIsoDate(input.asOfDate);
  const horizonDays = input.horizonDays;
  const horizonEnd = addDays(asOfDate, horizonDays);
  const openingCash = parsePaise(input.openingCashPaise);
  const minimumCash = parsePaise(input.minimumCashPaise);
  const includeUnconfirmed = input.includeUnconfirmedInflows ?? true;
  const isScenario = (input.scenarioActions?.length ?? 0) > 0;

  const items: InternalItem[] = [];

  // Map active AGREED / AT_RISK commitments to underlying records (never PROPOSED!)
  const agreedCommitments = (input.commitments ?? []).filter(
    (c) => c.status === 'AGREED' || c.status === 'AT_RISK',
  );

  const invoiceCommitmentMap = new Map<string, CommitmentDTO[]>();
  const billCommitmentMap = new Map<string, CommitmentDTO[]>();
  const expenseCommitmentMap = new Map<string, CommitmentDTO[]>();

  for (const c of agreedCommitments) {
    if (c.customerInvoiceId) {
      const arr = invoiceCommitmentMap.get(c.customerInvoiceId) ?? [];
      arr.push(c);
      invoiceCommitmentMap.set(c.customerInvoiceId, arr);
    }
    if (c.supplierBillId) {
      const arr = billCommitmentMap.get(c.supplierBillId) ?? [];
      arr.push(c);
      billCommitmentMap.set(c.supplierBillId, arr);
    }
    if (c.operatingExpenseId) {
      const arr = expenseCommitmentMap.get(c.operatingExpenseId) ?? [];
      arr.push(c);
      expenseCommitmentMap.set(c.operatingExpenseId, arr);
    }
  }

  // 1. Open Customer Invoices -> Expected Inflows
  for (const inv of input.invoices) {
    if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') continue;
    const outstanding = parsePaise(inv.outstandingPaise);
    if (outstanding <= 0n) continue;
    if (!includeUnconfirmed && inv.evidenceStatus === 'UNCONFIRMED') continue;

    let remaining = outstanding;
    const linked = invoiceCommitmentMap.get(inv.id) ?? [];
    for (const c of linked) {
      const agreedAmt = parsePaise(c.agreedAmountPaise ?? c.proposedAmountPaise);
      const fulfilled = parsePaise(c.fulfilledAmountPaise);
      const pendingAgreed = agreedAmt > fulfilled ? agreedAmt - fulfilled : 0n;
      const applied = pendingAgreed < remaining ? pendingAgreed : remaining;
      if (applied > 0n) {
        remaining -= applied;
        items.push({
          sourceType: 'COMMITMENT',
          sourceId: c.id,
          referenceCode: `${inv.invoiceNumber} (Agreed)`,
          counterpartyName: inv.retailerName ?? inv.retailerCode ?? 'Retailer',
          direction: 'INFLOW',
          amountPaise: applied,
          classification: 'EXPECTED',
          evidenceStatus: c.status === 'AT_RISK' ? 'AT_RISK_PROMISE' : 'AGREED_COMMITMENT',
          dueDate: parseIsoDate(c.agreedDate ?? c.dueDate),
          note: `Agreed ${c.actionType} on ${inv.invoiceNumber}`,
        });
      }
    }

    if (remaining > 0n) {
      items.push({
        sourceType: 'CUSTOMER_INVOICE',
        sourceId: inv.id,
        referenceCode: inv.invoiceNumber,
        counterpartyName: inv.retailerName ?? inv.retailerCode ?? 'Retailer',
        direction: 'INFLOW',
        amountPaise: remaining,
        classification: 'EXPECTED',
        evidenceStatus: inv.evidenceStatus,
        dueDate: parseIsoDate(inv.dueDate),
        note: inv.notes ?? undefined,
      });
    }
  }

  // 2. Open Supplier Bills -> Expected Outflows
  for (const bill of input.bills) {
    if (bill.status === 'PAID' || bill.status === 'CANCELLED') continue;
    const outstanding = parsePaise(bill.outstandingPaise);
    if (outstanding <= 0n) continue;

    let remaining = outstanding;
    const linked = billCommitmentMap.get(bill.id) ?? [];
    for (const c of linked) {
      const agreedAmt = parsePaise(c.agreedAmountPaise ?? c.proposedAmountPaise);
      const fulfilled = parsePaise(c.fulfilledAmountPaise);
      const pendingAgreed = agreedAmt > fulfilled ? agreedAmt - fulfilled : 0n;
      const applied = pendingAgreed < remaining ? pendingAgreed : remaining;
      if (applied > 0n) {
        remaining -= applied;
        items.push({
          sourceType: 'COMMITMENT',
          sourceId: c.id,
          referenceCode: `${bill.billNumber} (Deferred)`,
          counterpartyName: bill.supplierName ?? bill.supplierCode ?? 'Supplier',
          direction: 'OUTFLOW',
          amountPaise: applied,
          classification: 'EXPECTED',
          evidenceStatus: 'AGREED_DEFERRAL',
          dueDate: parseIsoDate(c.agreedDate ?? c.dueDate),
          note: `Agreed deferral on ${bill.billNumber}`,
        });
      }
    }

    if (remaining > 0n) {
      items.push({
        sourceType: 'SUPPLIER_BILL',
        sourceId: bill.id,
        referenceCode: bill.billNumber,
        counterpartyName: bill.supplierName ?? bill.supplierCode ?? 'Supplier',
        direction: 'OUTFLOW',
        amountPaise: remaining,
        classification: 'EXPECTED',
        evidenceStatus: bill.evidenceStatus,
        dueDate: parseIsoDate(bill.dueDate),
        note: bill.notes ?? undefined,
      });
    }
  }

  // 3. Open Operating Expenses -> Expected Outflows
  for (const exp of input.expenses) {
    if (exp.status === 'PAID' || exp.status === 'CANCELLED') continue;
    const outstanding = parsePaise(exp.outstandingPaise);
    if (outstanding <= 0n) continue;

    let remaining = outstanding;
    const linked = expenseCommitmentMap.get(exp.id) ?? [];
    for (const c of linked) {
      const agreedAmt = parsePaise(c.agreedAmountPaise ?? c.proposedAmountPaise);
      const applied = agreedAmt < remaining ? agreedAmt : remaining;
      if (applied > 0n) {
        remaining -= applied;
        items.push({
          sourceType: 'COMMITMENT',
          sourceId: c.id,
          referenceCode: `${exp.expenseCode} (Deferred)`,
          counterpartyName: exp.category,
          direction: 'OUTFLOW',
          amountPaise: applied,
          classification: 'EXPECTED',
          evidenceStatus: 'AGREED_DEFERRAL',
          dueDate: parseIsoDate(c.agreedDate ?? c.dueDate),
        });
      }
    }

    if (remaining > 0n) {
      items.push({
        sourceType: 'OPERATING_EXPENSE',
        sourceId: exp.id,
        referenceCode: exp.expenseCode,
        counterpartyName: exp.description,
        direction: 'OUTFLOW',
        amountPaise: remaining,
        classification: 'EXPECTED',
        evidenceStatus: 'CONFIRMED',
        dueDate: parseIsoDate(exp.dueDate),
      });
    }
  }

  // 4. Verified Actual Bank Transactions within [asOfDate .. horizonEnd]
  // Note: Open invoices/bills already have paid_amount_paise subtracted from outstandingPaise,
  // so including VERIFIED actual transactions from asOfDate onward reflects actual settled cash without double counting.
  for (const tx of input.transactions ?? []) {
    if (tx.verificationStatus !== 'VERIFIED' || tx.isReversed) continue;
    const vDate = parseIsoDate(tx.valueDate);
    if (compareIsoDate(vDate, asOfDate) < 0 || compareIsoDate(vDate, horizonEnd) > 0) continue;
    const amt = parsePaise(tx.amountPaise);
    if (amt <= 0n) continue;

    items.push({
      sourceType: 'PAYMENT_TRANSACTION',
      sourceId: tx.id,
      referenceCode: tx.externalTransactionReference ?? tx.id.slice(0, 8),
      counterpartyName: tx.matchedRetailerName ?? tx.payerDisplayName ?? 'Verified Bank Tx',
      direction: tx.direction,
      amountPaise: amt,
      classification: 'ACTUAL',
      evidenceStatus: 'VERIFIED',
      dueDate: vDate,
      note: `${tx.sourceType}: ${tx.narration}`,
    });
  }

  // 5. Overlay isolated Scenario / What-If Actions (purely in-memory, never mutating source records)
  const scenarioGeneratedItems: InternalItem[] = [];

  for (const action of input.scenarioActions ?? []) {
    const amt = parsePaise(action.amountPaise);
    if (amt <= 0n) continue;
    const simDate = parseIsoDate(action.simulatedDate);

    if (action.actionType === 'ACCELERATE_INFLOW' || action.actionType === 'DELAY_INFLOW') {
      // Shift up to `amt` from matching targetId (or reference) to `simulatedDate`
      let toShift = amt;
      for (const item of items) {
        if (toShift <= 0n) break;
        if (
          item.sourceType !== 'SCENARIO_ACTION' &&
          item.direction === 'INFLOW' &&
          item.sourceId === action.targetId &&
          item.amountPaise > 0n
        ) {
          const moved = item.amountPaise < toShift ? item.amountPaise : toShift;
          item.amountPaise -= moved;
          toShift -= moved;
          scenarioGeneratedItems.push({
            sourceType: 'SCENARIO_ACTION',
            sourceId: action.id ?? `scenario-${action.targetId}-${action.actionType}`,
            referenceCode: item.referenceCode,
            counterpartyName: item.counterpartyName,
            direction: 'INFLOW',
            amountPaise: moved,
            classification: 'SCENARIO',
            evidenceStatus: action.actionType,
            dueDate: simDate,
            note: `What-if ${action.actionType} (${action.targetLabel})`,
          });
        }
      }
    } else if (action.actionType === 'DEFER_OUTFLOW' || action.actionType === 'SPLIT_OUTFLOW') {
      let toDefer = amt;
      for (const item of items) {
        if (toDefer <= 0n) break;
        if (
          item.sourceType !== 'SCENARIO_ACTION' &&
          item.direction === 'OUTFLOW' &&
          item.sourceId === action.targetId &&
          item.amountPaise > 0n
        ) {
          const moved = item.amountPaise < toDefer ? item.amountPaise : toDefer;
          item.amountPaise -= moved;
          toDefer -= moved;
          scenarioGeneratedItems.push({
            sourceType: 'SCENARIO_ACTION',
            sourceId: action.id ?? `scenario-${action.targetId}-${action.actionType}`,
            referenceCode: item.referenceCode,
            counterpartyName: item.counterpartyName,
            direction: 'OUTFLOW',
            amountPaise: moved,
            classification: 'SCENARIO',
            evidenceStatus: action.actionType,
            dueDate: simDate,
            note: `What-if ${action.actionType} (${action.targetLabel})`,
          });
        }
      }
    } else if (action.actionType === 'DROP_INFLOW_PCT') {
      // `amt` holds percentage (0..100). Applies to expected receivables, preserving actual bank transactions.
      const pct = amt > 100n ? 100n : amt < 0n ? 0n : amt;
      for (const item of items) {
        if (
          item.direction === 'INFLOW' &&
          item.classification !== 'ACTUAL' &&
          (action.targetId === null || item.sourceId === action.targetId)
        ) {
          const drop = (item.amountPaise * pct) / 100n;
          item.amountPaise = item.amountPaise > drop ? item.amountPaise - drop : 0n;
        }
      }
    }
  }

  items.push(...scenarioGeneratedItems);

  // Bucket active items by calendar day within [asOfDate .. horizonEnd]
  const calendar = dateRange(asOfDate, horizonDays);
  const byDate = new Map<IsoDate, InternalItem[]>();
  for (const d of calendar) {
    byDate.set(d, []);
  }

  for (const item of items) {
    if (item.amountPaise <= 0n) continue;
    const bucketDate = effectiveDateWithinHorizon(item.dueDate, asOfDate, horizonEnd);
    if (bucketDate) {
      byDate.get(bucketDate)?.push(item);
    }
  }

  const days: ForecastDayEntry[] = [];
  let running = openingCash;
  let firstBreachDate: IsoDate | null = null;
  let firstBreachDayIndex: number | null = null;
  let firstBreachClosing: bigint | null = null;
  let lowestBalance = openingCash;
  let lowestBalanceDate = asOfDate;
  let recoveryDate: IsoDate | null = null;

  for (let i = 0; i < calendar.length; i += 1) {
    const date = calendar[i];
    const dayItems = byDate.get(date) ?? [];
    const opening = running;
    let inflows = 0n;
    let outflows = 0n;

    for (const item of dayItems) {
      if (item.direction === 'INFLOW') inflows += item.amountPaise;
      else outflows += item.amountPaise;
    }

    const closing = opening + inflows - outflows;
    running = closing;

    const belowMinimum = closing < minimumCash;
    const deficit = belowMinimum ? minimumCash - closing : 0n;

    if (belowMinimum && firstBreachDate === null) {
      firstBreachDate = date;
      firstBreachDayIndex = i;
      firstBreachClosing = closing;
    } else if (firstBreachDate !== null && !belowMinimum && recoveryDate === null) {
      recoveryDate = date;
    }

    if (closing < lowestBalance) {
      lowestBalance = closing;
      lowestBalanceDate = date;
    }

    days.push({
      date,
      dayIndex: i,
      openingBalancePaise: paiseToString(opening),
      totalInflowsPaise: paiseToString(inflows),
      totalOutflowsPaise: paiseToString(outflows),
      closingBalancePaise: paiseToString(closing),
      belowMinimum,
      deficitPaise: paiseToString(deficit),
      items: dayItems.map((it) => ({
        sourceType: it.sourceType,
        sourceId: it.sourceId,
        referenceCode: it.referenceCode,
        counterpartyName: it.counterpartyName,
        direction: it.direction,
        amountPaise: paiseToString(it.amountPaise),
        classification: it.classification,
        evidenceStatus: it.evidenceStatus,
        dueDate: it.dueDate,
        note: it.note,
      })),
    });
  }

  const finalClosing = days.length > 0 ? parsePaise(days[days.length - 1].closingBalancePaise) : openingCash;
  const shortfallPaise = firstBreachClosing !== null ? minimumCash - firstBreachClosing : 0n;
  const isTimingGapOnly = firstBreachDate !== null && finalClosing >= minimumCash;

  // Explain exact drivers causing first breach
  const outflowDrivers: ForecastItemTrace[] = [];
  const delayedOrUnconfirmedInflows: ForecastItemTrace[] = [];
  if (firstBreachDate !== null) {
    for (const d of days) {
      if (compareIsoDate(d.date, firstBreachDate) <= 0) {
        for (const it of d.items) {
          if (it.direction === 'OUTFLOW') outflowDrivers.push(it);
        }
      } else {
        for (const it of d.items) {
          if (it.direction === 'INFLOW') delayedOrUnconfirmedInflows.push(it);
        }
      }
    }
  }

  const explanationSummary =
    firstBreachDate === null
      ? 'No cash gap detected within the forecast horizon; all end-of-day balances remain at or above the configured minimum.'
      : isTimingGapOnly
        ? `Timing cash gap on ${firstBreachDate} (Day ${firstBreachDayIndex}): balance drops below minimum by ${paiseToString(shortfallPaise)} paise due to scheduled outflows before later receivables arrive (horizon ends above minimum).`
        : `Structural cash shortfall first breached on ${firstBreachDate} (Day ${firstBreachDayIndex}) with deficit of ${paiseToString(shortfallPaise)} paise and horizon ending below minimum.`;

  const breach: BreachDiagnostic = {
    firstBreachDate,
    firstBreachDayIndex,
    firstBreachClosingPaise: firstBreachClosing !== null ? paiseToString(firstBreachClosing) : null,
    minimumCashPaise: paiseToString(minimumCash),
    shortfallPaise: paiseToString(shortfallPaise),
    lowestBalanceDate,
    lowestBalancePaise: paiseToString(lowestBalance),
    recoveryDate,
    isTimingGapOnly,
    explanationSummary,
    outflowDrivers,
    delayedOrUnconfirmedInflows,
  };

  // Chase priority ranking
  const chasePriorities: ChasePriorityItem[] = input.invoices
    .filter((inv) => inv.status !== 'PAID' && inv.status !== 'CANCELLED' && inv.status !== 'WRITTEN_OFF')
    .map((inv) => {
      const out = parsePaise(inv.outstandingPaise);
      const daysUntilDue = diffDays(asOfDate, inv.dueDate);
      const urgencyBonus = daysUntilDue <= 0 ? 40 : daysUntilDue <= 7 ? 25 : daysUntilDue <= 14 ? 15 : 5;
      const evidenceBonus = inv.evidenceStatus === 'UNCONFIRMED' ? 25 : inv.evidenceStatus === 'DISPUTED' ? 30 : 10;
      const amountScore = Number(out / 100000n); // 1 point per ₹1,000
      const priorityScore = Math.round(urgencyBonus + evidenceBonus + Math.min(amountScore, 100));
      const rationale =
        daysUntilDue < 0
          ? `Overdue by ${Math.abs(daysUntilDue)} day(s); ${inv.evidenceStatus}`
          : `Due in ${daysUntilDue} day(s) (${inv.dueDate}); ${inv.evidenceStatus}`;

      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        retailerId: inv.retailerId,
        retailerCode: inv.retailerCode ?? '',
        retailerName: inv.retailerName ?? 'Retailer',
        dueDate: inv.dueDate,
        outstandingPaise: paiseToString(out),
        evidenceStatus: inv.evidenceStatus,
        reliabilityScore: 80,
        priorityScore,
        rationale,
      };
    })
    .filter((x) => parsePaise(x.outstandingPaise) > 0n)
    .sort((a, b) => b.priorityScore - a.priorityScore || a.dueDate.localeCompare(b.dueDate));

  // Trust Score Counters
  const txs = input.transactions ?? [];
  const actualCount = txs.filter((t) => t.verificationStatus === 'VERIFIED').length;
  const unmatchedOrAmbiguousPayments = txs.filter(
    (t) => t.matchStatus === 'UNMATCHED' || t.matchStatus === 'AMBIGUOUS',
  ).length;
  const confirmedInvs = input.invoices.filter((i) => i.evidenceStatus === 'CONFIRMED_PROMISE' || i.evidenceStatus === 'VERIFIED_PAID').length;
  const unconfirmedInvs = input.invoices.filter((i) => i.evidenceStatus === 'UNCONFIRMED').length;
  const confirmedBills = input.bills.filter((b) => b.evidenceStatus === 'CONFIRMED' || b.evidenceStatus === 'VERIFIED_PAID').length;
  const totalRecords = actualCount + input.invoices.length + input.bills.length + input.expenses.length;
  const trustedRecords = actualCount + confirmedInvs + confirmedBills + input.expenses.length;
  const trustRatioPct = totalRecords === 0 ? 100 : Math.round((trustedRecords * 100) / totalRecords);

  const trustCounters: TrustScoreCounters = {
    totalRecords,
    actualCount,
    confirmedCount: confirmedInvs + confirmedBills + input.expenses.length,
    unconfirmedExpectedCount: unconfirmedInvs,
    unmatchedOrAmbiguousPayments,
    trustRatioPct,
  };

  return {
    businessId: input.businessId,
    asOfDate,
    horizonDays,
    classification: isScenario ? 'SCENARIO_WHAT_IF' : 'ACTUAL_PLUS_EXPECTED',
    openingCashPaise: paiseToString(openingCash),
    minimumCashPaise: paiseToString(minimumCash),
    days,
    breach,
    chasePriorities,
    trustCounters,
  };
}

