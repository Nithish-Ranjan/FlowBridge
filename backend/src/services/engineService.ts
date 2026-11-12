import crypto from 'node:crypto';
import {
  addDays,
  compareIsoDate,
  computeCashForecast,
  diffDays,
  evaluatePromiseFailureRadar,
  formatINR,
  parseIsoDate,
  parsePaise,
  paiseToString,
  searchBoundedResolutions,
  type CommitmentDTO,
  type CustomerInvoiceDTO,
  type ForecastResult,
  type OperatingExpenseDTO,
  type PromiseRadarReport,
  type ResolutionSearchResult,
  type ScenarioActionInput,
  type SimulatedDelaySpec,
  type SupplierBillDTO,
} from '@flowbridge/shared';
import { withTransaction } from '../db/pool.js';
import { getBusinessById, listSuppliers } from '../db/repositories/businessRepo.js';
import {
  listCustomerInvoices,
  listOperatingExpenses,
  listSupplierBills,
} from '../db/repositories/ledgerRepo.js';
import {
  listAuditEvents,
  listImportBatches,
  listPaymentAllocations,
  listPaymentTransactions,
  recordAuditEvent,
} from '../db/repositories/paymentRepo.js';
import {
  listPaymentIdentifiers,
  listRetailers,
} from '../db/repositories/retailerRepo.js';
import {
  createProposedCommitment,
  createResolutionScenario,
  getResolutionScenarioById,
  listCommitments,
  listForecastSnapshots,
  listResolutionScenarios,
  recordCommitmentHumanReply,
  saveForecastSnapshot,
  type ForecastSnapshotDTO,
  type ResolutionScenarioDTO,
} from '../db/repositories/commitmentScenarioRepo.js';

export interface BusinessWorkspaceData {
  business: NonNullable<Awaited<ReturnType<typeof getBusinessById>>>;
  retailers: Awaited<ReturnType<typeof listRetailers>>;
  identifiers: Awaited<ReturnType<typeof listPaymentIdentifiers>>;
  suppliers: Awaited<ReturnType<typeof listSuppliers>>;
  invoices: CustomerInvoiceDTO[];
  bills: SupplierBillDTO[];
  expenses: OperatingExpenseDTO[];
  transactions: Awaited<ReturnType<typeof listPaymentTransactions>>;
  allocations: Awaited<ReturnType<typeof listPaymentAllocations>>;
  importBatches: Awaited<ReturnType<typeof listImportBatches>>;
  commitments: CommitmentDTO[];
  scenarios: ResolutionScenarioDTO[];
  snapshots: Awaited<ReturnType<typeof listForecastSnapshots>>;
  auditEvents: Awaited<ReturnType<typeof listAuditEvents>>;
}

export async function loadBusinessWorkspace(businessId: string): Promise<BusinessWorkspaceData> {
  const business = await getBusinessById(businessId);
  if (!business) {
    throw new Error('Business not found.');
  }

  const [
    retailers,
    identifiers,
    suppliers,
    invoices,
    bills,
    expenses,
    transactions,
    allocations,
    importBatches,
    commitments,
    scenarios,
    snapshots,
    auditEvents,
  ] = await Promise.all([
    listRetailers(businessId),
    listPaymentIdentifiers(businessId),
    listSuppliers(businessId),
    listCustomerInvoices(businessId),
    listSupplierBills(businessId),
    listOperatingExpenses(businessId),
    listPaymentTransactions(businessId),
    listPaymentAllocations(businessId),
    listImportBatches(businessId),
    listCommitments(businessId),
    listResolutionScenarios(businessId),
    listForecastSnapshots(businessId),
    listAuditEvents(businessId, 40),
  ]);

  return {
    business,
    retailers,
    identifiers,
    suppliers,
    invoices,
    bills,
    expenses,
    transactions,
    allocations,
    importBatches,
    commitments,
    scenarios,
    snapshots,
    auditEvents,
  };
}

export async function runForecast(
  businessId: string,
  options: {
    asOfDate?: string;
    horizonDays?: number;
    scenarioActions?: ScenarioActionInput[];
    includeUnconfirmedInflows?: boolean;
    saveSnapshotLabel?: string | null;
    scenarioId?: string | null;
  } = {},
): Promise<ForecastResult> {
  const ws = await loadBusinessWorkspace(businessId);
  const asOfDate = parseIsoDate(options.asOfDate ?? ws.business.openingCashDate);
  const horizonDays = options.horizonDays ?? 15;

  const forecast = computeCashForecast({
    businessId,
    asOfDate,
    horizonDays,
    openingCashPaise: ws.business.openingCashPaise,
    minimumCashPaise: ws.business.minimumCashPaise,
    invoices: ws.invoices,
    bills: ws.bills,
    expenses: ws.expenses,
    commitments: ws.commitments,
    transactions: ws.transactions,
    scenarioActions: options.scenarioActions,
    includeUnconfirmedInflows: options.includeUnconfirmedInflows,
  });

  if (options.saveSnapshotLabel) {
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ asOfDate, horizonDays, days: forecast.days }))
      .digest('hex')
      .slice(0, 24);

    await saveForecastSnapshot({
      businessId,
      scenarioId: options.scenarioId ?? null,
      snapshotLabel: options.saveSnapshotLabel,
      dataClassification:
        forecast.classification === 'SCENARIO_WHAT_IF' ? 'SCENARIO_WHAT_IF' : 'ACTUAL_PLUS_EXPECTED',
      asOfDate,
      horizonDays,
      firstBreachDate: forecast.breach.firstBreachDate,
      minimumBalancePaise: forecast.breach.lowestBalancePaise,
      openingCashPaise: forecast.openingCashPaise,
      series: forecast.days,
      diagnostics: {
        breach: forecast.breach,
        chasePriorities: forecast.chasePriorities,
        trustCounters: forecast.trustCounters,
      },
      inputFingerprint: fingerprint,
    });
  }

  return forecast;
}

export async function runBoundedResolutionSearch(
  businessId: string,
  options: { asOfDate?: string; horizonDays?: number } = {},
): Promise<ResolutionSearchResult> {
  const ws = await loadBusinessWorkspace(businessId);
  const asOfDate = parseIsoDate(options.asOfDate ?? ws.business.openingCashDate);
  const horizonDays = options.horizonDays ?? 15;

  const supplierMap = new Map(
    ws.suppliers.map((s) => [
      s.id,
      {
        maxDeferralDays: s.maxDeferralDays,
        maxDeferralPct: s.maxDeferralPct,
        isCritical: s.isCritical,
      },
    ]),
  );

  return searchBoundedResolutions(
    {
      businessId,
      asOfDate,
      horizonDays,
      openingCashPaise: ws.business.openingCashPaise,
      minimumCashPaise: ws.business.minimumCashPaise,
      invoices: ws.invoices,
      bills: ws.bills,
      expenses: ws.expenses,
      commitments: ws.commitments,
      transactions: ws.transactions,
    },
    ws.business.approvalLimits,
    supplierMap,
  );
}

export async function saveWhatIfScenario(
  businessId: string,
  input: {
    name: string;
    description?: string | null;
    scenarioKind: ResolutionScenarioDTO['scenarioKind'];
    asOfDate?: string;
    horizonDays?: number;
    actions: ScenarioActionInput[];
  },
): Promise<{ scenario: ResolutionScenarioDTO; forecast: ForecastResult }> {
  const ws = await loadBusinessWorkspace(businessId);
  const asOfDate = parseIsoDate(input.asOfDate ?? ws.business.openingCashDate);
  const horizonDays = input.horizonDays ?? 15;

  const forecast = computeCashForecast({
    businessId,
    asOfDate,
    horizonDays,
    openingCashPaise: ws.business.openingCashPaise,
    minimumCashPaise: ws.business.minimumCashPaise,
    invoices: ws.invoices,
    bills: ws.bills,
    expenses: ws.expenses,
    commitments: ws.commitments,
    transactions: ws.transactions,
    scenarioActions: input.actions,
  });

  const scenario = await withTransaction(async (client) => {
    const saved = await createResolutionScenario(
      {
        businessId,
        name: input.name,
        description: input.description,
        scenarioKind: input.scenarioKind,
        asOfDate,
        horizonDays,
        isFeasible: forecast.breach.firstBreachDate === null,
        actions: input.actions,
      },
      client,
    );

    await recordAuditEvent(
      {
        businessId,
        eventType: 'SCENARIO_SAVED',
        entityType: 'resolution_scenarios',
        entityId: saved.id,
        actor: 'DISTRIBUTOR',
        payload: {
          name: saved.name,
          kind: saved.scenarioKind,
          isFeasible: saved.isFeasible,
          firstBreachDate: forecast.breach.firstBreachDate,
        },
      },
      client,
    );
    return saved;
  });

  return { scenario, forecast };
}

export async function proposeCommitmentsFromActions(
  businessId: string,
  actions: Array<{
    counterpartyType: 'RETAILER' | 'SUPPLIER' | 'EXPENSE';
    retailerId?: string | null;
    customerInvoiceId?: string | null;
    supplierId?: string | null;
    supplierBillId?: string | null;
    operatingExpenseId?: string | null;
    scenarioId?: string | null;
    actionType: CommitmentDTO['actionType'];
    proposedAmountPaise: string;
    proposedDate: string;
  }>,
): Promise<CommitmentDTO[]> {
  return withTransaction(async (client) => {
    const created: CommitmentDTO[] = [];
    for (const action of actions) {
      const c = await createProposedCommitment(
        {
          businessId,
          ...action,
          proposedDate: parseIsoDate(action.proposedDate),
        },
        client,
      );
      created.push(c);
      await recordAuditEvent(
        {
          businessId,
          eventType: 'COMMITMENT_PROPOSED',
          entityType: 'commitments',
          entityId: c.id,
          actor: 'DISTRIBUTOR',
          payload: {
            actionType: c.actionType,
            proposedAmountPaise: c.proposedAmountPaise,
            proposedDate: c.proposedDate,
          },
        },
        client,
      );
    }
    return created;
  });
}

export async function recordHumanReplyOnCommitment(
  businessId: string,
  commitmentId: string,
  input: {
    decision: 'AGREED' | 'CANCELLED' | 'FAILED' | 'COMPLETED' | 'AT_RISK';
    humanReplyBy: string;
    humanReplyChannel: string;
    humanReplyNotes?: string | null;
    agreedAmountPaise?: string | null;
    agreedDate?: string | null;
    fulfilledAmountPaise?: string | null;
  },
): Promise<CommitmentDTO> {
  return withTransaction(async (client) => {
    const updated = await recordCommitmentHumanReply(
      {
        businessId,
        commitmentId,
        ...input,
        agreedDate: input.agreedDate ? parseIsoDate(input.agreedDate) : null,
      },
      client,
    );
    if (!updated) {
      throw new Error('Commitment not found.');
    }

    await recordAuditEvent(
      {
        businessId,
        eventType: `COMMITMENT_${input.decision}`,
        entityType: 'commitments',
        entityId: updated.id,
        actor: input.humanReplyBy,
        payload: {
          channel: input.humanReplyChannel,
          agreedAmountPaise: updated.agreedAmountPaise,
          agreedDate: updated.agreedDate,
        },
      },
      client,
    );

    return updated;
  });
}

export interface ActualVsPlanRow {
  commitmentId: string;
  actionType: string;
  status: string;
  expectedDate: string;
  expectedAmountPaise: string;
  actualFulfilledPaise: string;
  variancePaise: string;
  assessment: 'ON_TRACK' | 'FULFILLED' | 'SHORTFALL_OR_MISSED' | 'PROPOSED_AWAITING_HUMAN_REPLY';
}

export interface VerificationReport {
  asOfDate: string;
  radar: PromiseRadarReport;
  actualVsPlan: ActualVsPlanRow[];
  totalVerifiedInflowsPaise: string;
  totalPendingReviewInflowsPaise: string;
  negotiationTemplates: Array<{
    targetCode: string;
    counterparty: string;
    channel: 'WHATSAPP' | 'PHONE_SCRIPT';
    templateText: string;
  }>;
}

export async function runVerificationAndRadar(
  businessId: string,
  options: {
    asOfDate?: string;
    horizonDays?: number;
    simulatedDelays?: SimulatedDelaySpec[];
  } = {},
): Promise<VerificationReport> {
  const ws = await loadBusinessWorkspace(businessId);
  const asOfDate = parseIsoDate(options.asOfDate ?? ws.business.openingCashDate);
  const horizonDays = options.horizonDays ?? 16;

  const radar = evaluatePromiseFailureRadar(
    {
      businessId,
      asOfDate,
      horizonDays,
      openingCashPaise: ws.business.openingCashPaise,
      minimumCashPaise: ws.business.minimumCashPaise,
      invoices: ws.invoices,
      bills: ws.bills,
      expenses: ws.expenses,
      commitments: ws.commitments,
      transactions: ws.transactions,
    },
    options.simulatedDelays ?? [],
    {
      limits: ws.business.approvalLimits,
      supplierConstraints: new Map(
        ws.suppliers.map((s) => [
          s.id,
          { maxDeferralDays: s.maxDeferralDays, maxDeferralPct: s.maxDeferralPct, isCritical: s.isCritical },
        ]),
      ),
    },
  );

  const actualVsPlan: ActualVsPlanRow[] = ws.commitments.map((c) => {
    const exp = parsePaise(c.agreedAmountPaise ?? c.proposedAmountPaise);
    const act = parsePaise(c.fulfilledAmountPaise);
    const variance = act - exp;
    let assessment: ActualVsPlanRow['assessment'] = 'ON_TRACK';
    if (c.status === 'PROPOSED') {
      assessment = 'PROPOSED_AWAITING_HUMAN_REPLY';
    } else if (c.status === 'COMPLETED' || act >= exp) {
      assessment = 'FULFILLED';
    } else if (c.status === 'FAILED' || c.dueDate < asOfDate) {
      assessment = 'SHORTFALL_OR_MISSED';
    }

    return {
      commitmentId: c.id,
      actionType: c.actionType,
      status: c.status,
      expectedDate: c.agreedDate ?? c.proposedDate,
      expectedAmountPaise: paiseToString(exp),
      actualFulfilledPaise: paiseToString(act),
      variancePaise: paiseToString(variance),
      assessment,
    };
  });

  let verifiedInflow = 0n;
  let pendingInflow = 0n;
  for (const tx of ws.transactions) {
    if (tx.direction !== 'INFLOW' || tx.isReversed) continue;
    const amt = parsePaise(tx.amountPaise);
    if (tx.verificationStatus === 'VERIFIED') verifiedInflow += amt;
    else pendingInflow += amt;
  }

  // Deterministic Negotiation Copilot Templates (no AI/LLM)
  const templates: VerificationReport['negotiationTemplates'] = [];
  for (const inv of ws.invoices) {
    if (inv.status === 'PAID' || inv.status === 'CANCELLED') continue;
    const out = formatINR(inv.outstandingPaise);
    templates.push({
      targetCode: inv.invoiceNumber,
      counterparty: inv.retailerName ?? inv.retailerCode ?? 'Retailer',
      channel: 'WHATSAPP',
      templateText: `Hello ${inv.retailerName ?? 'Partner'}, gentle reminder regarding invoice ${inv.invoiceNumber} (${out}, due ${inv.dueDate}). Could you confirm if an early/partial settlement can be processed by ${addDays(ws.business.openingCashDate, 4)} via your registered UPI/Bank account with reference ${inv.invoiceNumber}?`,
    });
  }
  for (const bill of ws.bills) {
    if (bill.status === 'PAID' || bill.status === 'CANCELLED') continue;
    const out = formatINR(bill.outstandingPaise);
    templates.push({
      targetCode: bill.billNumber,
      counterparty: bill.supplierName ?? bill.supplierCode ?? 'Supplier',
      channel: 'PHONE_SCRIPT',
      templateText: `Hi ${bill.supplierName ?? 'Supplier'}, for bill ${bill.billNumber} (${out} due ${bill.dueDate}), we plan to pay the majority on schedule and request a 7-day deferral on a portion until ${addDays(bill.dueDate, 7)}. Please reply to confirm so we can log your agreement.`,
    });
  }

  return {
    asOfDate,
    radar,
    actualVsPlan,
    totalVerifiedInflowsPaise: paiseToString(verifiedInflow),
    totalPendingReviewInflowsPaise: paiseToString(pendingInflow),
    negotiationTemplates: templates,
  };
}

export async function getDashboardSummary(businessId: string, horizonDays = 15) {
  const ws = await loadBusinessWorkspace(businessId);
  const forecast = computeCashForecast({
    businessId,
    asOfDate: ws.business.openingCashDate,
    horizonDays,
    openingCashPaise: ws.business.openingCashPaise,
    minimumCashPaise: ws.business.minimumCashPaise,
    invoices: ws.invoices,
    bills: ws.bills,
    expenses: ws.expenses,
    commitments: ws.commitments,
    transactions: ws.transactions,
  });

  const openReceivables = ws.invoices
    .filter((i) => !['PAID', 'CANCELLED', 'WRITTEN_OFF'].includes(i.status))
    .reduce((acc, i) => acc + parsePaise(i.outstandingPaise), 0n);

  const openBills = ws.bills
    .filter((b) => !['PAID', 'CANCELLED'].includes(b.status))
    .reduce((acc, b) => acc + parsePaise(b.outstandingPaise), 0n);

  const openExpenses = ws.expenses
    .filter((e) => !['PAID', 'CANCELLED'].includes(e.status))
    .reduce((acc, e) => acc + parsePaise(e.outstandingPaise), 0n);

  const unmatchedPaymentCount = ws.transactions.filter(
    (t) => !t.isReversed && (t.matchStatus === 'UNMATCHED' || t.matchStatus === 'AMBIGUOUS'),
  ).length;

  const commitmentsAtRiskCount = ws.commitments.filter(
    (c) => c.status === 'AT_RISK' || c.status === 'FAILED',
  ).length;

  return {
    business: ws.business,
    cashTodayPaise: ws.business.openingCashPaise,
    totalReceivablesPaise: paiseToString(openReceivables),
    totalPayablesPaise: paiseToString(openBills + openExpenses),
    firstBreachDate: forecast.breach.firstBreachDate,
    firstBreachDayIndex: forecast.breach.firstBreachDayIndex,
    firstBreachClosingPaise: forecast.breach.firstBreachClosingPaise,
    shortfallPaise: forecast.breach.shortfallPaise,
    unmatchedPaymentCount,
    commitmentsAtRiskCount,
    trustCounters: forecast.trustCounters,
  };
}

export async function getForecastByRange(
  businessId: string,
  options: { from?: string; to?: string; scenarioId?: string | null },
) {
  const ws = await loadBusinessWorkspace(businessId);
  const from = parseIsoDate(options.from ?? ws.business.openingCashDate);
  const to = parseIsoDate(options.to ?? addDays(from, 15));
  const horizonDays = diffDays(from, to);
  if (horizonDays < 0 || horizonDays > 365) {
    throw new Error('Forecast date range must have to >= from and <= 365 days.');
  }

  let scenario: ResolutionScenarioDTO | null = null;
  if (options.scenarioId) {
    scenario = await getResolutionScenarioById(businessId, options.scenarioId);
    if (!scenario) throw new Error('Scenario not found.');
  }

  const forecast = computeCashForecast({
    businessId,
    asOfDate: from,
    horizonDays,
    openingCashPaise: ws.business.openingCashPaise,
    minimumCashPaise: ws.business.minimumCashPaise,
    invoices: ws.invoices,
    bills: ws.bills,
    expenses: ws.expenses,
    commitments: ws.commitments,
    transactions: ws.transactions,
    scenarioActions: scenario?.actions,
  });

  const dataQualityWarnings: string[] = [];
  if (forecast.trustCounters.unmatchedOrAmbiguousPayments > 0) {
    dataQualityWarnings.push(
      `${forecast.trustCounters.unmatchedOrAmbiguousPayments} bank transaction(s) are UNMATCHED or AMBIGUOUS and excluded from invoice settlement until reviewed.`,
    );
  }
  if (forecast.trustCounters.unconfirmedExpectedCount > 0) {
    dataQualityWarnings.push(
      `${forecast.trustCounters.unconfirmedExpectedCount} expected invoice(s) are UNCONFIRMED.`,
    );
  }

  return {
    forecast,
    scenario,
    dataQualityWarnings,
    timingGapExplanation: forecast.breach.isTimingGapOnly
      ? `Total horizon inflows recover cash to ${formatINR(forecast.days[forecast.days.length - 1]?.closingBalancePaise ?? '0')} by ${to}, but outflows on ${forecast.breach.firstBreachDate} arrive before those later receipts.`
      : forecast.breach.explanationSummary,
  };
}

export async function recalculateAndSaveSnapshot(
  businessId: string,
  options: { asOfDate?: string; horizonDays?: number; snapshotLabel?: string; scenarioId?: string | null } = {},
): Promise<{ snapshot: ForecastSnapshotDTO; forecast: ForecastResult }> {
  const ws = await loadBusinessWorkspace(businessId);
  const asOfDate = parseIsoDate(options.asOfDate ?? ws.business.openingCashDate);
  const horizonDays = options.horizonDays ?? 15;

  let scenario: ResolutionScenarioDTO | null = null;
  if (options.scenarioId) {
    scenario = await getResolutionScenarioById(businessId, options.scenarioId);
    if (!scenario) throw new Error('Scenario not found.');
  }

  const forecast = computeCashForecast({
    businessId,
    asOfDate,
    horizonDays,
    openingCashPaise: ws.business.openingCashPaise,
    minimumCashPaise: ws.business.minimumCashPaise,
    invoices: ws.invoices,
    bills: ws.bills,
    expenses: ws.expenses,
    commitments: ws.commitments,
    transactions: ws.transactions,
    scenarioActions: scenario?.actions,
  });

  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({ asOfDate, horizonDays, scenarioId: scenario?.id ?? null, days: forecast.days }))
    .digest('hex')
    .slice(0, 24);

  const snapshot = await saveForecastSnapshot({
    businessId,
    scenarioId: scenario?.id ?? null,
    snapshotLabel: options.snapshotLabel ?? (scenario ? `Scenario: ${scenario.name}` : 'Recalculated Forecast'),
    dataClassification:
      forecast.classification === 'SCENARIO_WHAT_IF' ? 'SCENARIO_WHAT_IF' : 'ACTUAL_PLUS_EXPECTED',
    asOfDate,
    horizonDays,
    firstBreachDate: forecast.breach.firstBreachDate,
    minimumBalancePaise: forecast.breach.lowestBalancePaise,
    openingCashPaise: forecast.openingCashPaise,
    series: forecast.days,
    diagnostics: {
      breach: forecast.breach,
      chasePriorities: forecast.chasePriorities,
      trustCounters: forecast.trustCounters,
    },
    inputFingerprint: fingerprint,
  });

  return { snapshot, forecast };
}

export async function getChasePriorityBeforeDate(businessId: string, beforeDateParam?: string) {
  const ws = await loadBusinessWorkspace(businessId);
  const forecast = computeCashForecast({
    businessId,
    asOfDate: ws.business.openingCashDate,
    horizonDays: 30,
    openingCashPaise: ws.business.openingCashPaise,
    minimumCashPaise: ws.business.minimumCashPaise,
    invoices: ws.invoices,
    bills: ws.bills,
    expenses: ws.expenses,
    commitments: ws.commitments,
    transactions: ws.transactions,
  });

  const targetDate = beforeDateParam
    ? parseIsoDate(beforeDateParam)
    : forecast.breach.firstBreachDate ?? addDays(ws.business.openingCashDate, 15);
  const retailerMap = new Map(ws.retailers.map((r) => [r.id, r]));
  const limits = ws.business.approvalLimits;

  const ranked = ws.invoices
    .filter((i) => !['PAID', 'CANCELLED', 'WRITTEN_OFF'].includes(i.status) && parsePaise(i.outstandingPaise) > 0n)
    .map((inv) => {
      const ret = retailerMap.get(inv.retailerId);
      const reliability = ret?.reliabilityScore ?? 80;
      const out = parsePaise(inv.outstandingPaise);
      const maxRequestable = (out * BigInt(limits.maxEarlyRequestPct)) / 100n;
      const daysAfterBreach = diffDays(targetDate, inv.dueDate);
      const canBridgeBreach =
        compareIsoDate(inv.dueDate, targetDate) <= 0 ||
        daysAfterBreach <= limits.maxEarlyDays;

      const reasons: string[] = [];
      let score = 0;

      if (compareIsoDate(inv.dueDate, targetDate) <= 0) {
        score += 45;
        reasons.push(`Already due on/before ${targetDate}`);
      } else if (daysAfterBreach <= limits.maxEarlyDays) {
        score += 35 - Math.min(daysAfterBreach, 14);
        reasons.push(`Due ${daysAfterBreach}d after ${targetDate} (within ${limits.maxEarlyDays}d early-request window)`);
      } else {
        score += 5;
        reasons.push(`Due ${daysAfterBreach}d after ${targetDate} (outside ${limits.maxEarlyDays}d window)`);
      }

      if (inv.evidenceStatus === 'CONFIRMED_PROMISE') {
        score += 25;
        reasons.push('Confirmed promise (+25 confidence)');
      } else if (inv.evidenceStatus === 'UNCONFIRMED') {
        score += 15;
        reasons.push('Unconfirmed receivable — requires confirmation chase');
      } else {
        reasons.push(`Evidence status: ${inv.evidenceStatus}`);
      }

      score += Math.round(reliability / 5);
      reasons.push(`Retailer reliability score ${reliability}/100`);

      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        retailerId: inv.retailerId,
        retailerCode: inv.retailerCode ?? ret?.retailerCode ?? '',
        retailerName: inv.retailerName ?? ret?.name ?? 'Retailer',
        dueDate: inv.dueDate,
        outstandingPaise: inv.outstandingPaise,
        maxRequestableEarlyPaise: paiseToString(maxRequestable),
        canArriveBeforeGap: canBridgeBreach,
        evidenceStatus: inv.evidenceStatus,
        reliabilityScore: reliability,
        priorityScore: score,
        reasons,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || a.dueDate.localeCompare(b.dueDate));

  return {
    beforeDate: targetDate,
    firstBreachDate: forecast.breach.firstBreachDate,
    shortfallPaise: forecast.breach.shortfallPaise,
    invoices: ranked,
  };
}

export async function reconcileCommitmentsWithBankRows(
  businessId: string,
  options: { asOfDate?: string; assumeBankDataComplete?: boolean } = {},
) {
  const ws = await loadBusinessWorkspace(businessId);
  const asOfDate = parseIsoDate(options.asOfDate ?? ws.business.openingCashDate);
  const txs = ws.transactions.filter((t) => !t.isReversed);
  const hasPendingUnmatched = txs.some(
    (t) => t.matchStatus === 'UNMATCHED' || t.matchStatus === 'AMBIGUOUS' || t.verificationStatus === 'PENDING_REVIEW',
  );
  let latestTxDate: string | null = null;
  for (const t of txs) {
    if (!latestTxDate || compareIsoDate(t.valueDate, latestTxDate) > 0) {
      latestTxDate = t.valueDate;
    }
  }

  const results: Array<{
    commitmentId: string;
    actionType: string;
    dueDate: string;
    expectedAmountPaise: string;
    fulfilledAmountPaise: string;
    reconciliationStatus: 'MATCHED' | 'PARTIAL' | 'MISSED' | 'UNKNOWN_NEEDS_REVIEW' | 'PENDING_FUTURE';
    explanation: string;
  }> = [];

  for (const c of ws.commitments) {
    if (c.status === 'PROPOSED' || c.status === 'CANCELLED') continue;
    const targetAmt = parsePaise(c.agreedAmountPaise ?? c.proposedAmountPaise);
    const fulfilled = parsePaise(c.fulfilledAmountPaise);
    const due = c.agreedDate ?? c.dueDate;

    if (fulfilled >= targetAmt || c.status === 'COMPLETED') {
      results.push({
        commitmentId: c.id,
        actionType: c.actionType,
        dueDate: due,
        expectedAmountPaise: paiseToString(targetAmt),
        fulfilledAmountPaise: paiseToString(fulfilled),
        reconciliationStatus: 'MATCHED',
        explanation: 'Verified receipts / settlement fully satisfy agreed commitment.',
      });
    } else if (compareIsoDate(due, asOfDate) > 0) {
      results.push({
        commitmentId: c.id,
        actionType: c.actionType,
        dueDate: due,
        expectedAmountPaise: paiseToString(targetAmt),
        fulfilledAmountPaise: paiseToString(fulfilled),
        reconciliationStatus: fulfilled > 0n ? 'PARTIAL' : 'PENDING_FUTURE',
        explanation: `Due date ${due} has not yet passed as of ${asOfDate}.`,
      });
    } else {
      const bankCovers =
        Boolean(options.assumeBankDataComplete) ||
        (!hasPendingUnmatched && latestTxDate !== null && compareIsoDate(latestTxDate, due) >= 0);

      if (!bankCovers) {
        results.push({
          commitmentId: c.id,
          actionType: c.actionType,
          dueDate: due,
          expectedAmountPaise: paiseToString(targetAmt),
          fulfilledAmountPaise: paiseToString(fulfilled),
          reconciliationStatus: 'UNKNOWN_NEEDS_REVIEW',
          explanation: 'Bank feed/imports are incomplete or contain unreviewed matches; cannot infer miss automatically.',
        });
      } else {
        results.push({
          commitmentId: c.id,
          actionType: c.actionType,
          dueDate: due,
          expectedAmountPaise: paiseToString(targetAmt),
          fulfilledAmountPaise: paiseToString(fulfilled),
          reconciliationStatus: 'MISSED',
          explanation: `Due ${due} passed with bank imports verified and shortfall ${paiseToString(targetAmt - fulfilled)} paise.`,
        });
      }
    }
  }

  const radar = evaluatePromiseFailureRadar(
    {
      businessId,
      asOfDate,
      horizonDays: 16,
      openingCashPaise: ws.business.openingCashPaise,
      minimumCashPaise: ws.business.minimumCashPaise,
      invoices: ws.invoices,
      bills: ws.bills,
      expenses: ws.expenses,
      commitments: ws.commitments,
      transactions: ws.transactions,
    },
    [],
    {
      limits: ws.business.approvalLimits,
      supplierConstraints: new Map(
        ws.suppliers.map((s) => [
          s.id,
          { maxDeferralDays: s.maxDeferralDays, maxDeferralPct: s.maxDeferralPct, isCritical: s.isCritical },
        ]),
      ),
      latestBankImportDate: options.assumeBankDataComplete ? asOfDate : latestTxDate,
    },
  );

  return {
    asOfDate,
    bankDataCompleteThrough: latestTxDate,
    hasPendingUnmatched,
    commitmentsReconciled: results,
    radar,
  };
}

