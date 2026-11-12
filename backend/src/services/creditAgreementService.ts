import { paiseToString, parsePaise } from '@flowbridge/shared';
import { getPool, withTransaction } from '../db/pool.js';
import { recordAuditEvent } from '../db/repositories/paymentRepo.js';

export interface CreditAgreementDTO {
  id: string;
  businessId: string;
  retailerId: string;
  retailerName: string;
  retailerCode: string;
  agreementNumber: string;
  creditLimitPaise: string;
  standardTermDays: number;
  gracePeriodDays: number;
  lateFeePct: number;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditSaleCheckResult {
  allowed: boolean;
  reason: string;
  creditLimitPaise: string;
  currentOutstandingPaise: string;
  proposedExposurePaise: string;
  activeAgreementNumber: string | null;
}

export async function listCreditAgreements(businessId: string): Promise<CreditAgreementDTO[]> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    business_id: string;
    retailer_id: string;
    retailer_name: string;
    retailer_code: string;
    agreement_number: string;
    credit_limit_paise: string;
    standard_term_days: number;
    grace_period_days: number;
    late_fee_pct: string;
    status: string;
    valid_from: string;
    valid_until: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT ca.id, ca.business_id, ca.retailer_id, r.name AS retailer_name, r.retailer_code,
            ca.agreement_number, ca.credit_limit_paise, ca.standard_term_days, ca.grace_period_days,
            ca.late_fee_pct, ca.status, ca.valid_from, ca.valid_until, ca.notes, ca.created_at, ca.updated_at
     FROM credit_agreements ca
     JOIN retailers r ON r.id = ca.retailer_id
     WHERE ca.business_id = $1
     ORDER BY ca.created_at DESC`,
    [businessId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    retailerId: row.retailer_id,
    retailerName: row.retailer_name,
    retailerCode: row.retailer_code,
    agreementNumber: row.agreement_number,
    creditLimitPaise: row.credit_limit_paise,
    standardTermDays: row.standard_term_days,
    gracePeriodDays: row.grace_period_days,
    lateFeePct: Number(row.late_fee_pct),
    status: row.status as CreditAgreementDTO['status'],
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createCreditAgreement(input: {
  businessId: string;
  retailerId: string;
  agreementNumber?: string;
  creditLimitPaise: string;
  standardTermDays?: number;
  gracePeriodDays?: number;
  lateFeePct?: number;
  validFrom?: string;
  validUntil?: string | null;
  notes?: string;
}): Promise<CreditAgreementDTO> {
  const agrNum =
    input.agreementNumber?.trim() ||
    `AGR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
  const validFrom = input.validFrom || new Date().toISOString().slice(0, 10);
  const termDays = input.standardTermDays ?? 30;
  const graceDays = input.gracePeriodDays ?? 7;
  const feePct = input.lateFeePct ?? 0;

  return withTransaction(async (client) => {
    const res = await client.query<{
      id: string;
      business_id: string;
      retailer_id: string;
      agreement_number: string;
      credit_limit_paise: string;
      standard_term_days: number;
      grace_period_days: number;
      late_fee_pct: string;
      status: string;
      valid_from: string;
      valid_until: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO credit_agreements (
        business_id, retailer_id, agreement_number, credit_limit_paise, standard_term_days,
        grace_period_days, late_fee_pct, status, valid_from, valid_until, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9, $10)
      RETURNING *`,
      [
        input.businessId,
        input.retailerId,
        agrNum,
        input.creditLimitPaise,
        termDays,
        graceDays,
        feePct,
        validFrom,
        input.validUntil ?? null,
        input.notes ?? null,
      ],
    );

    const ret = await client.query<{ name: string; retailer_code: string }>(
      'SELECT name, retailer_code FROM retailers WHERE id = $1',
      [input.retailerId],
    );

    const row = res.rows[0];
    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'CREDIT_AGREEMENT_CREATED',
        entityType: 'credit_agreements',
        entityId: row.id,
        actor: 'Owner / Desk',
        payload: { agreementNumber: agrNum, creditLimitPaise: input.creditLimitPaise },
      },
      client,
    );

    return {
      id: row.id,
      businessId: row.business_id,
      retailerId: row.retailer_id,
      retailerName: ret.rows[0]?.name ?? 'Retailer',
      retailerCode: ret.rows[0]?.retailer_code ?? '',
      agreementNumber: row.agreement_number,
      creditLimitPaise: row.credit_limit_paise,
      standardTermDays: row.standard_term_days,
      gracePeriodDays: row.grace_period_days,
      lateFeePct: Number(row.late_fee_pct),
      status: 'ACTIVE',
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function checkCreditSaleProtection(
  businessId: string,
  retailerId: string,
  requestedSalePaise: string,
): Promise<CreditSaleCheckResult> {
  const pool = getPool();
  const reqAmt = parsePaise(requestedSalePaise);

  const agrRes = await pool.query<{ agreement_number: string; credit_limit_paise: string }>(
    `SELECT agreement_number, credit_limit_paise
     FROM credit_agreements
     WHERE business_id = $1 AND retailer_id = $2 AND status = 'ACTIVE'
     ORDER BY created_at DESC LIMIT 1`,
    [businessId, retailerId],
  );

  if (agrRes.rows.length === 0) {
    return {
      allowed: false,
      reason: 'No active credit agreement on file for this retailer. Business policy requires an active agreement before approving credit sales.',
      creditLimitPaise: '0',
      currentOutstandingPaise: '0',
      proposedExposurePaise: requestedSalePaise,
      activeAgreementNumber: null,
    };
  }

  const activeAgr = agrRes.rows[0];
  const limitPaise = parsePaise(activeAgr.credit_limit_paise);

  const outstandingRes = await pool.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(total_amount_paise - paid_amount_paise), 0) AS total
     FROM customer_invoices
     WHERE business_id = $1 AND retailer_id = $2 AND status IN ('OPEN', 'OVERDUE')`,
    [businessId, retailerId],
  );

  const currentOutstanding = parsePaise(outstandingRes.rows[0]?.total ?? '0');
  const proposedExposure = currentOutstanding + reqAmt;

  if (proposedExposure > limitPaise) {
    return {
      allowed: false,
      reason: `Proposed exposure (₹${paiseToString(proposedExposure)}) exceeds approved credit limit (₹${paiseToString(limitPaise)}). Requires distributor override.`,
      creditLimitPaise: activeAgr.credit_limit_paise,
      currentOutstandingPaise: paiseToString(currentOutstanding),
      proposedExposurePaise: paiseToString(proposedExposure),
      activeAgreementNumber: activeAgr.agreement_number,
    };
  }

  return {
    allowed: true,
    reason: `Within approved credit limit (₹${paiseToString(limitPaise)}). Remaining capacity: ₹${paiseToString(limitPaise - proposedExposure)}.`,
    creditLimitPaise: activeAgr.credit_limit_paise,
    currentOutstandingPaise: paiseToString(currentOutstanding),
    proposedExposurePaise: paiseToString(proposedExposure),
    activeAgreementNumber: activeAgr.agreement_number,
  };
}
