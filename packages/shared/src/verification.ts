import { addDays, compareIsoDate, type IsoDate } from './dates.js';
import { computeCashForecast, type ForecastInput, type ScenarioActionInput } from './forecast.js';
import { parsePaise, paiseToString } from './money.js';
import { searchBoundedResolutions, type ResolutionSearchResult } from './resolution.js';
import type { ApprovalLimits, CommitmentDTO, ForecastResult } from './types.js';

export interface PromiseFailureAlert {
  alertType: 'MISSED_COMMITMENT' | 'DELAYED_INVOICE' | 'AT_RISK_COMMITMENT' | 'UNKNOWN_NEEDS_REVIEW';
  severity: 'HIGH' | 'MEDIUM';
  recordId: string;
  referenceCode: string;
  expectedDate: IsoDate;
  expectedAmountPaise: string;
  fulfilledAmountPaise: string;
  shortfallAmountPaise: string;
  message: string;
}

export interface PromiseRadarReport {
  asOfDate: IsoDate;
  bankDataCompleteThrough: IsoDate | null;
  hasIncompleteBankData: boolean;
  alerts: PromiseFailureAlert[];
  rerunForecast: ForecastResult;
  replanResult: ResolutionSearchResult | null;
}

export interface SimulatedDelaySpec {
  invoiceId: string;
  delayDays: number;
}

/**
 * Evaluate active commitments and unconfirmed expected receipts against `asOfDate`, bank data completeness,
 * and optional simulated delays. Never falsely marks a commitment MISSED if bank data is incomplete;
 * classifies as UNKNOWN_NEEDS_REVIEW instead. Reruns forecast and invokes bounded resolution planner when needed.
 */
export function evaluatePromiseFailureRadar(
  input: ForecastInput,
  simulatedDelays: SimulatedDelaySpec[] = [],
  options?: {
    limits?: ApprovalLimits;
    supplierConstraints?: Map<string, { maxDeferralDays: number; maxDeferralPct: number; isCritical: boolean }>;
    latestBankImportDate?: IsoDate | null;
  },
): PromiseRadarReport {
  const alerts: PromiseFailureAlert[] = [];
  const delayScenarioActions: ScenarioActionInput[] = [...(input.scenarioActions ?? [])];

  const txs = input.transactions ?? [];
  const hasPendingUnmatchedTxs = txs.some(
    (t) => !t.isReversed && (t.matchStatus === 'UNMATCHED' || t.matchStatus === 'AMBIGUOUS' || t.verificationStatus === 'PENDING_REVIEW'),
  );

  let latestBankDate: IsoDate | null = options?.latestBankImportDate ?? null;
  for (const t of txs) {
    if (!t.isReversed && (latestBankDate === null || compareIsoDate(t.valueDate, latestBankDate) > 0)) {
      latestBankDate = t.valueDate;
    }
  }

  for (const c of input.commitments ?? []) {
    if (c.status !== 'AGREED' && c.status !== 'AT_RISK') continue;
    const agreedAmt = parsePaise(c.agreedAmountPaise ?? c.proposedAmountPaise);
    const fulfilled = parsePaise(c.fulfilledAmountPaise);
    const pending = agreedAmt > fulfilled ? agreedAmt - fulfilled : 0n;
    if (pending <= 0n) continue;

    const targetDate = c.agreedDate ?? c.dueDate;
    if (compareIsoDate(targetDate, input.asOfDate) < 0) {
      const bankDataCoversTarget =
        !hasPendingUnmatchedTxs && latestBankDate !== null && compareIsoDate(latestBankDate, targetDate) >= 0;

      if (!bankDataCoversTarget) {
        alerts.push({
          alertType: 'UNKNOWN_NEEDS_REVIEW',
          severity: 'MEDIUM',
          recordId: c.id,
          referenceCode: c.actionType,
          expectedDate: targetDate,
          expectedAmountPaise: paiseToString(agreedAmt),
          fulfilledAmountPaise: paiseToString(fulfilled),
          shortfallAmountPaise: paiseToString(pending),
          message: `Commitment ${c.actionType} due ${targetDate} shows UNKNOWN / NEEDS REVIEW because bank import/match data through ${targetDate} is incomplete or has unreviewed transactions.`,
        });
      } else {
        alerts.push({
          alertType: 'MISSED_COMMITMENT',
          severity: 'HIGH',
          recordId: c.id,
          referenceCode: c.actionType,
          expectedDate: targetDate,
          expectedAmountPaise: paiseToString(agreedAmt),
          fulfilledAmountPaise: paiseToString(fulfilled),
          shortfallAmountPaise: paiseToString(pending),
          message: `Agreed ${c.actionType} due ${targetDate} missed by ${paiseToString(pending)} paise as of ${input.asOfDate}.`,
        });
      }
    } else if (c.status === 'AT_RISK') {
      alerts.push({
        alertType: 'AT_RISK_COMMITMENT',
        severity: 'MEDIUM',
        recordId: c.id,
        referenceCode: c.actionType,
        expectedDate: targetDate,
        expectedAmountPaise: paiseToString(agreedAmt),
        fulfilledAmountPaise: paiseToString(fulfilled),
        shortfallAmountPaise: paiseToString(pending),
        message: `Commitment ${c.actionType} due ${targetDate} is marked AT_RISK.`,
      });
    }
  }

  for (const delay of simulatedDelays) {
    const inv = input.invoices.find((i) => i.id === delay.invoiceId);
    if (!inv) continue;
    const newDate = addDays(inv.dueDate, delay.delayDays);
    alerts.push({
      alertType: 'DELAYED_INVOICE',
      severity: 'HIGH',
      recordId: inv.id,
      referenceCode: inv.invoiceNumber,
      expectedDate: inv.dueDate,
      expectedAmountPaise: inv.outstandingPaise,
      fulfilledAmountPaise: '0',
      shortfallAmountPaise: inv.outstandingPaise,
      message: `${inv.invoiceNumber} (${inv.retailerName ?? 'Retailer'}) delayed by ${delay.delayDays} day(s) from ${inv.dueDate} to ${newDate}.`,
    });

    delayScenarioActions.push({
      id: `delay-${inv.id}`,
      targetType: 'CUSTOMER_INVOICE',
      targetId: inv.id,
      targetLabel: inv.invoiceNumber,
      actionType: 'DELAY_INFLOW',
      amountPaise: inv.outstandingPaise,
      originalDate: inv.dueDate,
      simulatedDate: newDate,
    });
  }

  const updatedInput: ForecastInput = {
    ...input,
    scenarioActions: delayScenarioActions,
  };
  const rerunForecast = computeCashForecast(updatedInput);

  let replanResult: ResolutionSearchResult | null = null;
  if (rerunForecast.breach.firstBreachDate !== null && options?.limits) {
    const adjustedInvoices = input.invoices.map((inv) => {
      const delay = simulatedDelays.find((d) => d.invoiceId === inv.id);
      return delay ? { ...inv, dueDate: addDays(inv.dueDate, delay.delayDays) } : inv;
    });
    replanResult = searchBoundedResolutions(
      { ...input, invoices: adjustedInvoices },
      options.limits,
      options.supplierConstraints ?? new Map(),
    );
  }

  return {
    asOfDate: input.asOfDate,
    bankDataCompleteThrough: latestBankDate,
    hasIncompleteBankData:
      hasPendingUnmatchedTxs ||
      latestBankDate === null ||
      compareIsoDate(latestBankDate, input.asOfDate) < 0,
    alerts,
    rerunForecast,
    replanResult,
  };
}

export function canTransitionCommitmentToAgreed(commitment: CommitmentDTO, humanReplyBy: string | null): boolean {
  return (
    commitment.status === 'PROPOSED' &&
    typeof humanReplyBy === 'string' &&
    humanReplyBy.trim().length > 0
  );
}
