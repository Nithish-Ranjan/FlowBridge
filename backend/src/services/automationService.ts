import { getPool, withTransaction } from '../db/pool.js';
import { recordAuditEvent } from '../db/repositories/paymentRepo.js';

export interface AutomationRuleDTO {
  id: string;
  businessId: string;
  ruleName: string;
  eventTrigger: 'INVOICE_OVERDUE' | 'PAYMENT_UNMATCHED' | 'FORECAST_BREACH' | 'COMMITMENT_MISSED';
  actionType: 'SEND_REMINDER' | 'ALERT_OWNER' | 'TRIGGER_AUTOPILOT' | 'DRAFT_NEGOTIATION';
  conditionsJson: Record<string, unknown>;
  isActive: boolean;
  requiresApproval: boolean;
  createdAt: string;
}

export interface AutomationQueueItemDTO {
  id: string;
  businessId: string;
  ruleId: string | null;
  title: string;
  description: string;
  status: 'PENDING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'REJECTED';
  actionPayload: Record<string, unknown>;
  approvedBy: string | null;
  decisionNotes: string | null;
  scheduledFor: string;
  executedAt: string | null;
  createdAt: string;
}

export async function listAutomationRules(businessId: string): Promise<AutomationRuleDTO[]> {
  const pool = getPool();
  let res = await pool.query<{
    id: string;
    business_id: string;
    rule_name: string;
    event_trigger: string;
    action_type: string;
    conditions_json: Record<string, unknown>;
    is_active: boolean;
    requires_approval: boolean;
    created_at: string;
  }>(
    `SELECT * FROM automation_rules WHERE business_id = $1 ORDER BY created_at ASC`,
    [businessId],
  );

  if (res.rows.length === 0) {
    // Seed default baseline automation rules
    await pool.query(
      `INSERT INTO automation_rules (business_id, rule_name, event_trigger, action_type, conditions_json, is_active, requires_approval)
       VALUES 
       ($1, 'Overdue Invoice Reminder Dispatch', 'INVOICE_OVERDUE', 'SEND_REMINDER', '{"graceDays": 2}'::jsonb, true, true),
       ($1, 'Autonomous Cash Gap Autopilot', 'FORECAST_BREACH', 'TRIGGER_AUTOPILOT', '{"minGapPaise": 1000000}'::jsonb, true, false),
       ($1, 'Missed Commitment Restructuring Draft', 'COMMITMENT_MISSED', 'DRAFT_NEGOTIATION', '{}'::jsonb, true, true)`,
      [businessId],
    );
    res = await pool.query(`SELECT * FROM automation_rules WHERE business_id = $1 ORDER BY created_at ASC`, [businessId]);
  }

  return res.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    ruleName: row.rule_name,
    eventTrigger: row.event_trigger as AutomationRuleDTO['eventTrigger'],
    actionType: row.action_type as AutomationRuleDTO['actionType'],
    conditionsJson: row.conditions_json,
    isActive: row.is_active,
    requiresApproval: row.requires_approval,
    createdAt: row.created_at,
  }));
}

export async function listAutomationQueue(businessId: string): Promise<AutomationQueueItemDTO[]> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    business_id: string;
    rule_id: string | null;
    title: string;
    description: string;
    status: string;
    action_payload: Record<string, unknown>;
    approved_by: string | null;
    decision_notes: string | null;
    scheduled_for: string;
    executed_at: string | null;
    created_at: string;
  }>(
    `SELECT * FROM automation_queue WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [businessId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    ruleId: row.rule_id,
    title: row.title,
    description: row.description,
    status: row.status as AutomationQueueItemDTO['status'],
    actionPayload: row.action_payload,
    approvedBy: row.approved_by,
    decisionNotes: row.decision_notes,
    scheduledFor: row.scheduled_for,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  }));
}

export async function approveQueueItem(input: {
  queueId: string;
  businessId: string;
  approvedBy: string;
  notes?: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE automation_queue
       SET status = 'COMPLETED', approved_by = $1, decision_notes = $2, executed_at = now()
       WHERE id = $3 AND business_id = $4`,
      [input.approvedBy, input.notes || 'Approved by owner', input.queueId, input.businessId],
    );

    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'AUTOMATION_ACTION_APPROVED',
        entityType: 'automation_queue',
        entityId: input.queueId,
        actor: input.approvedBy,
        payload: { queueId: input.queueId, notes: input.notes },
      },
      client,
    );
  });
}

export async function rejectQueueItem(input: {
  queueId: string;
  businessId: string;
  rejectedBy: string;
  notes?: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE automation_queue
     SET status = 'REJECTED', approved_by = $1, decision_notes = $2, executed_at = now()
     WHERE id = $3 AND business_id = $4`,
    [input.rejectedBy, input.notes || 'Rejected by owner', input.queueId, input.businessId],
  );
}

export async function queueAutomationAction(input: {
  businessId: string;
  ruleId?: string;
  title: string;
  description: string;
  actionPayload: Record<string, unknown>;
  requiresApproval?: boolean;
}): Promise<AutomationQueueItemDTO> {
  const pool = getPool();
  const status = input.requiresApproval ? 'PENDING_APPROVAL' : 'COMPLETED';
  const executedAt = input.requiresApproval ? null : new Date().toISOString();

  const res = await pool.query<any>(
    `INSERT INTO automation_queue (
      business_id, rule_id, title, description, status, action_payload, executed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      input.businessId,
      input.ruleId ?? null,
      input.title,
      input.description,
      status,
      input.actionPayload,
      executedAt,
    ],
  );

  const row = res.rows[0];
  return {
    id: row.id,
    businessId: row.business_id,
    ruleId: row.rule_id,
    title: row.title,
    description: row.description,
    status: row.status,
    actionPayload: row.action_payload,
    approvedBy: null,
    decisionNotes: null,
    scheduledFor: row.scheduled_for,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  };
}
