import type { PoolClient } from 'pg';
import type {
  CommitmentActionType,
  CommitmentDTO,
  CommitmentStatus,
  ScenarioActionInput,
} from '@flowbridge/shared';
import { query } from '../pool.js';

interface CommitmentRow {
  id: string;
  business_id: string;
  counterparty_type: 'RETAILER' | 'SUPPLIER' | 'EXPENSE';
  retailer_id: string | null;
  customer_invoice_id: string | null;
  supplier_id: string | null;
  supplier_bill_id: string | null;
  operating_expense_id: string | null;
  scenario_id: string | null;
  action_type: CommitmentActionType;
  proposed_amount_paise: string;
  proposed_date: string;
  agreed_amount_paise: string | null;
  agreed_date: string | null;
  due_date: string;
  status: CommitmentStatus;
  human_reply_recorded: boolean;
  human_reply_by: string | null;
  human_reply_channel: string | null;
  human_reply_notes: string | null;
  human_replied_at: Date | null;
  fulfilled_amount_paise: string;
  created_at: Date;
  updated_at: Date;
}

export interface ResolutionScenarioDTO {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  scenarioKind: 'BASELINE' | 'RESOLUTION_PLAN' | 'SHOCKWAVE_WHAT_IF' | 'EMERGENCY_FALLBACK';
  asOfDate: string;
  horizonDays: number;
  isFeasible: boolean | null;
  status: 'DRAFT' | 'SAVED' | 'ARCHIVED';
  actions: ScenarioActionInput[];
  createdAt: string;
  updatedAt: string;
}

export interface ForecastSnapshotDTO {
  id: string;
  businessId: string;
  scenarioId: string | null;
  snapshotLabel: string | null;
  dataClassification: 'ACTUAL_ONLY' | 'ACTUAL_PLUS_EXPECTED' | 'SCENARIO_WHAT_IF';
  asOfDate: string;
  generatedAt: string;
  horizonDays: number;
  firstBreachDate: string | null;
  minimumBalancePaise: string;
  openingCashPaise: string;
  series: unknown;
  diagnostics: unknown;
  inputFingerprint: string;
}

function mapCommitment(row: CommitmentRow): CommitmentDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    counterpartyType: row.counterparty_type,
    retailerId: row.retailer_id,
    customerInvoiceId: row.customer_invoice_id,
    supplierId: row.supplier_id,
    supplierBillId: row.supplier_bill_id,
    operatingExpenseId: row.operating_expense_id,
    scenarioId: row.scenario_id,
    actionType: row.action_type,
    proposedAmountPaise: row.proposed_amount_paise,
    proposedDate: row.proposed_date,
    agreedAmountPaise: row.agreed_amount_paise,
    agreedDate: row.agreed_date,
    dueDate: row.due_date,
    status: row.status,
    humanReplyRecorded: row.human_reply_recorded,
    humanReplyBy: row.human_reply_by,
    humanReplyChannel: row.human_reply_channel,
    humanReplyNotes: row.human_reply_notes,
    humanRepliedAt: row.human_replied_at ? row.human_replied_at.toISOString() : null,
    fulfilledAmountPaise: row.fulfilled_amount_paise,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCommitments(businessId: string, client?: PoolClient): Promise<CommitmentDTO[]> {
  const res = await query<CommitmentRow>(
    'SELECT * FROM commitments WHERE business_id = $1 ORDER BY due_date ASC, created_at DESC',
    [businessId],
    client,
  );
  return res.rows.map(mapCommitment);
}

export async function getCommitmentById(
  businessId: string,
  commitmentId: string,
  client?: PoolClient,
): Promise<CommitmentDTO | null> {
  const res = await query<CommitmentRow>(
    'SELECT * FROM commitments WHERE id = $1 AND business_id = $2',
    [commitmentId, businessId],
    client,
  );
  return res.rows[0] ? mapCommitment(res.rows[0]) : null;
}

export async function createProposedCommitment(
  input: {
    businessId: string;
    counterpartyType: 'RETAILER' | 'SUPPLIER' | 'EXPENSE';
    retailerId?: string | null;
    customerInvoiceId?: string | null;
    supplierId?: string | null;
    supplierBillId?: string | null;
    operatingExpenseId?: string | null;
    scenarioId?: string | null;
    actionType: CommitmentActionType;
    proposedAmountPaise: string;
    proposedDate: string;
  },
  client?: PoolClient,
): Promise<CommitmentDTO> {
  const res = await query<CommitmentRow>(
    `INSERT INTO commitments (
      business_id, counterparty_type, retailer_id, customer_invoice_id, supplier_id,
      supplier_bill_id, operating_expense_id, scenario_id, action_type,
      proposed_amount_paise, proposed_date, due_date, status, human_reply_recorded
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 'PROPOSED', false)
    RETURNING *`,
    [
      input.businessId,
      input.counterpartyType,
      input.retailerId ?? null,
      input.customerInvoiceId ?? null,
      input.supplierId ?? null,
      input.supplierBillId ?? null,
      input.operatingExpenseId ?? null,
      input.scenarioId ?? null,
      input.actionType,
      input.proposedAmountPaise,
      input.proposedDate,
    ],
    client,
  );
  return mapCommitment(res.rows[0]);
}

export async function recordCommitmentHumanReply(
  input: {
    businessId: string;
    commitmentId: string;
    decision: 'AGREED' | 'CANCELLED' | 'FAILED' | 'COMPLETED' | 'AT_RISK';
    humanReplyBy: string;
    humanReplyChannel: string;
    humanReplyNotes?: string | null;
    agreedAmountPaise?: string | null;
    agreedDate?: string | null;
    fulfilledAmountPaise?: string | null;
  },
  client?: PoolClient,
): Promise<CommitmentDTO | null> {
  const current = await getCommitmentById(input.businessId, input.commitmentId, client);
  if (!current) return null;

  const agreedAmount = input.agreedAmountPaise ?? current.agreedAmountPaise ?? current.proposedAmountPaise;
  const agreedDate = input.agreedDate ?? current.agreedDate ?? current.proposedDate;
  const fulfilled = input.fulfilledAmountPaise ?? current.fulfilledAmountPaise;

  const res = await query<CommitmentRow>(
    `UPDATE commitments
        SET status = $3,
            agreed_amount_paise = $4,
            agreed_date = $5,
            due_date = $5,
            human_reply_recorded = true,
            human_reply_by = $6,
            human_reply_channel = $7,
            human_reply_notes = $8,
            human_replied_at = now(),
            fulfilled_amount_paise = $9
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
    [
      input.commitmentId,
      input.businessId,
      input.decision,
      agreedAmount,
      agreedDate,
      input.humanReplyBy,
      input.humanReplyChannel,
      input.humanReplyNotes ?? null,
      fulfilled,
    ],
    client,
  );
  return res.rows[0] ? mapCommitment(res.rows[0]) : null;
}

export async function listResolutionScenarios(
  businessId: string,
  client?: PoolClient,
): Promise<ResolutionScenarioDTO[]> {
  const scenariosRes = await query<{
    id: string;
    business_id: string;
    name: string;
    description: string | null;
    scenario_kind: ResolutionScenarioDTO['scenarioKind'];
    as_of_date: string;
    horizon_days: number;
    is_feasible: boolean | null;
    status: ResolutionScenarioDTO['status'];
    created_at: Date;
    updated_at: Date;
  }>(
    'SELECT * FROM resolution_scenarios WHERE business_id = $1 ORDER BY created_at DESC',
    [businessId],
    client,
  );

  const actionsRes = await query<{
    id: string;
    scenario_id: string;
    target_type: ScenarioActionInput['targetType'];
    target_id: string | null;
    target_label: string;
    action_type: ScenarioActionInput['actionType'];
    amount_paise: string;
    original_date: string | null;
    simulated_date: string;
  }>(
    'SELECT * FROM scenario_actions WHERE business_id = $1 ORDER BY action_order ASC',
    [businessId],
    client,
  );

  const byScenario = new Map<string, ScenarioActionInput[]>();
  for (const a of actionsRes.rows) {
    const arr = byScenario.get(a.scenario_id) ?? [];
    arr.push({
      id: a.id,
      targetType: a.target_type,
      targetId: a.target_id,
      targetLabel: a.target_label,
      actionType: a.action_type,
      amountPaise: a.amount_paise,
      originalDate: a.original_date,
      simulatedDate: a.simulated_date,
    });
    byScenario.set(a.scenario_id, arr);
  }

  return scenariosRes.rows.map((s) => ({
    id: s.id,
    businessId: s.business_id,
    name: s.name,
    description: s.description,
    scenarioKind: s.scenario_kind,
    asOfDate: s.as_of_date,
    horizonDays: s.horizon_days,
    isFeasible: s.is_feasible,
    status: s.status,
    actions: byScenario.get(s.id) ?? [],
    createdAt: s.created_at.toISOString(),
    updatedAt: s.updated_at.toISOString(),
  }));
}

export async function createResolutionScenario(
  input: {
    businessId: string;
    name: string;
    description?: string | null;
    scenarioKind: ResolutionScenarioDTO['scenarioKind'];
    asOfDate: string;
    horizonDays: number;
    isFeasible: boolean | null;
    actions: ScenarioActionInput[];
  },
  client?: PoolClient,
): Promise<ResolutionScenarioDTO> {
  const sRes = await query<{
    id: string;
    business_id: string;
    name: string;
    description: string | null;
    scenario_kind: ResolutionScenarioDTO['scenarioKind'];
    as_of_date: string;
    horizon_days: number;
    is_feasible: boolean | null;
    status: ResolutionScenarioDTO['status'];
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO resolution_scenarios (
      business_id, name, description, scenario_kind, as_of_date, horizon_days, is_feasible, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SAVED')
    RETURNING *`,
    [
      input.businessId,
      input.name,
      input.description ?? null,
      input.scenarioKind,
      input.asOfDate,
      input.horizonDays,
      input.isFeasible,
    ],
    client,
  );
  const scenario = sRes.rows[0];

  const savedActions: ScenarioActionInput[] = [];
  for (let i = 0; i < input.actions.length; i += 1) {
    const a = input.actions[i];
    const aRes = await query<{ id: string }>(
      `INSERT INTO scenario_actions (
        business_id, scenario_id, action_order, target_type, target_id,
        target_label, action_type, amount_paise, original_date, simulated_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        input.businessId,
        scenario.id,
        i + 1,
        a.targetType,
        a.targetId,
        a.targetLabel,
        a.actionType,
        a.amountPaise,
        a.originalDate,
        a.simulatedDate,
      ],
      client,
    );
    savedActions.push({ ...a, id: aRes.rows[0].id });
  }

  return {
    id: scenario.id,
    businessId: scenario.business_id,
    name: scenario.name,
    description: scenario.description,
    scenarioKind: scenario.scenario_kind,
    asOfDate: scenario.as_of_date,
    horizonDays: scenario.horizon_days,
    isFeasible: scenario.is_feasible,
    status: scenario.status,
    actions: savedActions,
    createdAt: scenario.created_at.toISOString(),
    updatedAt: scenario.updated_at.toISOString(),
  };
}

export async function saveForecastSnapshot(
  input: {
    businessId: string;
    scenarioId?: string | null;
    snapshotLabel?: string | null;
    dataClassification: ForecastSnapshotDTO['dataClassification'];
    asOfDate: string;
    horizonDays: number;
    firstBreachDate: string | null;
    minimumBalancePaise: string;
    openingCashPaise: string;
    series: unknown;
    diagnostics: unknown;
    inputFingerprint: string;
  },
  client?: PoolClient,
): Promise<ForecastSnapshotDTO> {
  const res = await query<{
    id: string;
    business_id: string;
    scenario_id: string | null;
    snapshot_label: string | null;
    data_classification: ForecastSnapshotDTO['dataClassification'];
    as_of_date: string;
    generated_at: Date;
    horizon_days: number;
    first_breach_date: string | null;
    minimum_balance_paise: string;
    opening_cash_paise: string;
    series_json: unknown;
    diagnostics_json: unknown;
    input_fingerprint: string;
  }>(
    `INSERT INTO forecast_snapshots (
      business_id, scenario_id, snapshot_label, data_classification, as_of_date, horizon_days,
      first_breach_date, minimum_balance_paise, opening_cash_paise, series_json, diagnostics_json, input_fingerprint
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
    RETURNING *`,
    [
      input.businessId,
      input.scenarioId ?? null,
      input.snapshotLabel ?? null,
      input.dataClassification,
      input.asOfDate,
      input.horizonDays,
      input.firstBreachDate,
      input.minimumBalancePaise,
      input.openingCashPaise,
      JSON.stringify(input.series),
      JSON.stringify(input.diagnostics),
      input.inputFingerprint,
    ],
    client,
  );
  const r = res.rows[0];
  return {
    id: r.id,
    businessId: r.business_id,
    scenarioId: r.scenario_id,
    snapshotLabel: r.snapshot_label,
    dataClassification: r.data_classification,
    asOfDate: r.as_of_date,
    generatedAt: r.generated_at.toISOString(),
    horizonDays: r.horizon_days,
    firstBreachDate: r.first_breach_date,
    minimumBalancePaise: r.minimum_balance_paise,
    openingCashPaise: r.opening_cash_paise,
    series: r.series_json,
    diagnostics: r.diagnostics_json,
    inputFingerprint: r.input_fingerprint,
  };
}

export async function getResolutionScenarioById(
  businessId: string,
  scenarioId: string,
  client?: PoolClient,
): Promise<ResolutionScenarioDTO | null> {
  const all = await listResolutionScenarios(businessId, client);
  return all.find((s) => s.id === scenarioId) ?? null;
}

export async function getForecastSnapshotById(
  businessId: string,
  snapshotId: string,
  client?: PoolClient,
): Promise<ForecastSnapshotDTO | null> {
  const res = await query<{
    id: string;
    business_id: string;
    scenario_id: string | null;
    snapshot_label: string | null;
    data_classification: ForecastSnapshotDTO['dataClassification'];
    as_of_date: string;
    generated_at: Date;
    horizon_days: number;
    first_breach_date: string | null;
    minimum_balance_paise: string;
    opening_cash_paise: string;
    series_json: unknown;
    diagnostics_json: unknown;
    input_fingerprint: string;
  }>(
    'SELECT * FROM forecast_snapshots WHERE id = $1 AND business_id = $2',
    [snapshotId, businessId],
    client,
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    businessId: r.business_id,
    scenarioId: r.scenario_id,
    snapshotLabel: r.snapshot_label,
    dataClassification: r.data_classification,
    asOfDate: r.as_of_date,
    generatedAt: r.generated_at.toISOString(),
    horizonDays: r.horizon_days,
    firstBreachDate: r.first_breach_date,
    minimumBalancePaise: r.minimum_balance_paise,
    openingCashPaise: r.opening_cash_paise,
    series: r.series_json,
    diagnostics: r.diagnostics_json,
    inputFingerprint: r.input_fingerprint,
  };
}

export async function listForecastSnapshots(
  businessId: string,
  client?: PoolClient,
): Promise<ForecastSnapshotDTO[]> {
  const res = await query<{
    id: string;
    business_id: string;
    scenario_id: string | null;
    snapshot_label: string | null;
    data_classification: ForecastSnapshotDTO['dataClassification'];
    as_of_date: string;
    generated_at: Date;
    horizon_days: number;
    first_breach_date: string | null;
    minimum_balance_paise: string;
    opening_cash_paise: string;
    series_json: unknown;
    diagnostics_json: unknown;
    input_fingerprint: string;
  }>(
    'SELECT * FROM forecast_snapshots WHERE business_id = $1 ORDER BY generated_at DESC LIMIT 20',
    [businessId],
    client,
  );

  return res.rows.map((r) => ({
    id: r.id,
    businessId: r.business_id,
    scenarioId: r.scenario_id,
    snapshotLabel: r.snapshot_label,
    dataClassification: r.data_classification,
    asOfDate: r.as_of_date,
    generatedAt: r.generated_at.toISOString(),
    horizonDays: r.horizon_days,
    firstBreachDate: r.first_breach_date,
    minimumBalancePaise: r.minimum_balance_paise,
    openingCashPaise: r.opening_cash_paise,
    series: r.series_json,
    diagnostics: r.diagnostics_json,
    inputFingerprint: r.input_fingerprint,
  }));
}

