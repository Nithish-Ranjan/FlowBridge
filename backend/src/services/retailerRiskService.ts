import { paiseToString, parsePaise } from '@flowbridge/shared';
import { getPool } from '../db/pool.js';

export interface RetailerRiskProfileDTO {
  retailerId: string;
  retailerName: string;
  retailerCode: string;
  riskCategory: 'LOW_RISK' | 'MODERATE_RISK' | 'AT_RISK' | 'HIGH_RISK' | 'INSUFFICIENT_DATA';
  reliabilityScore: number;
  reasons: string[];
  totalOutstandingPaise: string;
  creditLimitPaise: string;
  overdueInvoicesCount: number;
  brokenCommitmentsCount: number;
  suggestedAction: string;
}

export async function evaluateRetailerRiskProfiles(businessId: string): Promise<RetailerRiskProfileDTO[]> {
  const pool = getPool();

  const retailersRes = await pool.query<{
    id: string;
    name: string;
    retailer_code: string;
    reliability_score: number;
    credit_limit_paise: string | null;
  }>(
    `SELECT r.id, r.name, r.retailer_code, r.reliability_score,
            (SELECT ca.credit_limit_paise
             FROM credit_agreements ca
             WHERE ca.retailer_id = r.id AND ca.status = 'ACTIVE'
             ORDER BY ca.created_at DESC LIMIT 1) AS credit_limit_paise
     FROM retailers r
     WHERE r.business_id = $1`,
    [businessId],
  );

  const profiles: RetailerRiskProfileDTO[] = [];

  for (const ret of retailersRes.rows) {
    const invRes = await pool.query<{
      status: string;
      evidence_status: string;
      total_amount_paise: string;
      paid_amount_paise: string;
      due_date: string;
    }>(
      `SELECT status, evidence_status, total_amount_paise, paid_amount_paise, due_date
       FROM customer_invoices
       WHERE business_id = $1 AND retailer_id = $2`,
      [businessId, ret.id],
    );

    const commRes = await pool.query<{ status: string }>(
      `SELECT status FROM commitments
       WHERE business_id = $1 AND retailer_id = $2`,
      [businessId, ret.id],
    );

    const invoices = invRes.rows;
    const commitments = commRes.rows;

    const paidCount = invoices.filter((i) => i.status === 'PAID').length;
    const overdueInvoices = invoices.filter((i) => i.status === 'OVERDUE');
    const openInvoices = invoices.filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE');
    const brokenCommitments = commitments.filter((c) => c.status === 'FAILED');

    let totalOutstanding = 0n;
    for (const inv of openInvoices) {
      const tot = parsePaise(inv.total_amount_paise);
      const paid = parsePaise(inv.paid_amount_paise);
      totalOutstanding += tot > paid ? tot - paid : 0n;
    }

    const creditLimit = parsePaise(ret.credit_limit_paise ?? '0');
    const reasons: string[] = [];
    let score = ret.reliability_score ?? 80;

    if (invoices.length < 2) {
      profiles.push({
        retailerId: ret.id,
        retailerName: ret.name,
        retailerCode: ret.retailer_code,
        riskCategory: 'INSUFFICIENT_DATA',
        reliabilityScore: score,
        reasons: ['Fewer than 2 historical transactions on record. Insufficient data for dynamic scoring.'],
        totalOutstandingPaise: paiseToString(totalOutstanding),
        creditLimitPaise: paiseToString(creditLimit),
        overdueInvoicesCount: overdueInvoices.length,
        brokenCommitmentsCount: brokenCommitments.length,
        suggestedAction: 'Require advance or 14-day standard credit agreement with strict initial limit.',
      });
      continue;
    }

    if (overdueInvoices.length > 0) {
      score -= overdueInvoices.length * 15;
      reasons.push(`${overdueInvoices.length} invoice(s) currently past due.`);
    }

    if (brokenCommitments.length > 0) {
      score -= brokenCommitments.length * 20;
      reasons.push(`${brokenCommitments.length} broken/missed payment commitment(s) on record.`);
    }

    if (creditLimit > 0n && totalOutstanding > creditLimit) {
      score -= 25;
      reasons.push(`Outstanding balance exceeds approved credit limit by ₹${paiseToString(totalOutstanding - creditLimit)}.`);
    } else if (paidCount > 3 && overdueInvoices.length === 0) {
      score += 10;
      reasons.push('Consistent on-time settlement record across recent invoices.');
    }

    score = Math.max(5, Math.min(100, score));

    let riskCategory: RetailerRiskProfileDTO['riskCategory'] = 'MODERATE_RISK';
    let suggestedAction = 'Monitor upcoming payments.';

    if (score >= 85) {
      riskCategory = 'LOW_RISK';
      suggestedAction = 'Eligible for standard 30-day credit terms and early-collection incentives.';
    } else if (score >= 65) {
      riskCategory = 'MODERATE_RISK';
      suggestedAction = 'Maintain standard monitoring and verify payment identifiers.';
    } else if (score >= 40) {
      riskCategory = 'AT_RISK';
      suggestedAction = 'Follow up 3 days before due date; restrict additional credit orders.';
    } else {
      riskCategory = 'HIGH_RISK';
      suggestedAction = 'Hold further credit sales; initiate formal payment restructuring.';
    }

    profiles.push({
      retailerId: ret.id,
      retailerName: ret.name,
      retailerCode: ret.retailer_code,
      riskCategory,
      reliabilityScore: score,
      reasons,
      totalOutstandingPaise: paiseToString(totalOutstanding),
      creditLimitPaise: paiseToString(creditLimit),
      overdueInvoicesCount: overdueInvoices.length,
      brokenCommitmentsCount: brokenCommitments.length,
      suggestedAction,
    });
  }

  return profiles;
}
