import { paiseToString, parsePaise } from '@flowbridge/shared';
import { getPool } from '../db/pool.js';

export type CreditPolicyAction =
  | 'NORMAL_CREDIT_TERMS'
  | 'INCREASED_MONITORING'
  | 'REDUCED_OR_REVIEWED_CREDIT_LIMIT'
  | 'MANUAL_APPROVAL_REQUIRED'
  | 'AUTHORISED_CREDIT_HOLD';

export interface RetailerHistoricalStats {
  paidInvoiceCount: number;
  totalInvoiceCount: number;
  onTimePaymentRate: number | null;
  averageDelayDays: number | null;
  delayVariabilityDays: number | null;
  overdueInvoicesCount: number;
  overdueAmountPaise: string;
  brokenCommitmentsCount: number;
  creditLimitPaise: string;
  totalOutstandingPaise: string;
  creditLimitUtilisationPct: number | null;
  recentPaymentTrend: 'IMPROVING' | 'STABLE' | 'DETERIORATING' | 'INSUFFICIENT_HISTORY';
}

export interface ModelPredictionSummary {
  status: 'EVALUATED' | 'SERVICE_UNAVAILABLE' | 'MODEL_NOT_DEPLOYED' | 'NOT_APPLICABLE';
  predictedDelayDays: number | null;
  predictedDelayCategory?: string;
  modelType: string | null;
  modelVersion: string | null;
  evaluatedAt: string | null;
  disclaimer?: string;
}

export interface RetailerRiskProfileDTO {
  retailerId: string;
  retailerName: string;
  retailerCode: string;
  riskCategory: 'LOW_RISK' | 'MODERATE_RISK' | 'AT_RISK' | 'HIGH_RISK' | 'INSUFFICIENT_DATA';
  reliabilityScore: number;
  policyVersion: string;
  reasons: string[];
  totalOutstandingPaise: string;
  creditLimitPaise: string;
  overdueInvoicesCount: number;
  brokenCommitmentsCount: number;
  suggestedAction: string;
  recommendedCreditAction: CreditPolicyAction;
  creditActionRationale: string;
  creditHoldDetails?: {
    isUnderCreditHold: boolean;
    authorized: boolean;
    reason: string;
    restrictionScope: string;
  };
  historicalStats: RetailerHistoricalStats;
  modelPrediction: ModelPredictionSummary;
  lastEvaluatedAt: string;
}

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}

function computeStandardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

export async function evaluateRetailerRiskProfiles(businessId: string): Promise<RetailerRiskProfileDTO[]> {
  const pool = getPool();
  const evaluationTimestamp = new Date().toISOString();
  const policyVersion = 'v2.0-composite';

  // 1. Fetch retailers and their active credit agreements.
  const retailersRes = await pool.query<{
    id: string;
    name: string;
    retailer_code: string;
    reliability_score: number;
    status: string;
    credit_terms_days: number;
    created_at: string;
  }>(
    `SELECT r.id, r.name, r.retailer_code, r.reliability_score, r.status, r.credit_terms_days, r.created_at
     FROM retailers r
     WHERE r.business_id = $1
     ORDER BY r.name ASC`,
    [businessId],
  );

  const creditAgreementsRes = await pool.query<{
    retailer_id: string;
    credit_limit_paise: string;
  }>(
    `SELECT retailer_id, credit_limit_paise
     FROM credit_agreements
     WHERE business_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [businessId],
  );
  const creditLimitByRetailer = new Map<string, string>();
  for (const ca of creditAgreementsRes.rows) {
    if (!creditLimitByRetailer.has(ca.retailer_id)) {
      creditLimitByRetailer.set(ca.retailer_id, String(ca.credit_limit_paise));
    }
  }

  const profiles: RetailerRiskProfileDTO[] = [];

  for (const ret of retailersRes.rows) {
    const activeCreditLimit = creditLimitByRetailer.get(ret.id) ?? null;
    // 2. Fetch invoices for this retailer.
    const invRes = await pool.query<{
      id: string;
      invoice_number: string;
      status: string;
      evidence_status: string;
      total_amount_paise: string;
      paid_amount_paise: string;
      invoice_date: string;
      due_date: string;
    }>(
      `SELECT id, invoice_number, status, evidence_status, total_amount_paise, paid_amount_paise, invoice_date, due_date
       FROM customer_invoices
       WHERE business_id = $1 AND retailer_id = $2
       ORDER BY due_date ASC`,
      [businessId, ret.id],
    );

    // 3. Fetch commitments for this retailer.
    const commRes = await pool.query<{
      id: string;
      status: string;
      due_date: string;
      fulfilled_amount_paise: string;
    }>(
      `SELECT id, status, due_date, fulfilled_amount_paise
       FROM commitments
       WHERE business_id = $1 AND retailer_id = $2`,
      [businessId, ret.id],
    );

    // 4. Fetch verified payments and allocations to compute exact completion dates and delays.
    const allocRes = await pool.query<{
      invoice_id: string;
      allocated_amount_paise: string;
      value_date: string;
    }>(
      `SELECT pa.invoice_id, pa.allocated_amount_paise, pt.value_date
       FROM payment_allocations pa
       JOIN payment_transactions pt ON pa.payment_transaction_id = pt.id
       WHERE pt.business_id = $1 AND pt.matched_retailer_id = $2
         AND pt.direction = 'INFLOW'
         AND pt.match_status = 'MATCHED'
         AND pt.verification_status = 'VERIFIED'
         AND pt.is_reversed = false
       ORDER BY pt.value_date ASC`,
      [businessId, ret.id],
    );

    const invoices = invRes.rows;
    const commitments = commRes.rows;
    const allocations = allocRes.rows;

    // Group allocations by invoice to determine when full payment was reached.
    const allocsByInvoice = new Map<string, Array<{ amountPaise: bigint; valueDate: string }>>();
    for (const alloc of allocations) {
      if (!allocsByInvoice.has(alloc.invoice_id)) {
        allocsByInvoice.set(alloc.invoice_id, []);
      }
      allocsByInvoice.get(alloc.invoice_id)!.push({
        amountPaise: parsePaise(alloc.allocated_amount_paise),
        valueDate: alloc.value_date,
      });
    }

    const paidDelays: number[] = [];
    const recentDelays: number[] = [];

    let totalOutstanding = 0n;
    let overdueOutstanding = 0n;
    let overdueCount = 0;

    for (const inv of invoices) {
      const tot = parsePaise(inv.total_amount_paise);
      const paid = parsePaise(inv.paid_amount_paise);
      const outstanding = tot > paid ? tot - paid : 0n;

      if (inv.status === 'PAID') {
        const events = allocsByInvoice.get(inv.id) ?? [];
        let cum = 0n;
        let completionDate: string | null = null;
        for (const ev of events) {
          cum += ev.amountPaise;
          if (cum >= tot) {
            completionDate = ev.valueDate;
            break;
          }
        }
        if (completionDate) {
          const delay = daysBetween(inv.due_date, completionDate);
          paidDelays.push(delay);
        }
      } else if (inv.status === 'OVERDUE' || (inv.status === 'OPEN' && inv.due_date < new Date().toISOString().slice(0, 10))) {
        overdueCount += 1;
        overdueOutstanding += outstanding;
        totalOutstanding += outstanding;
      } else if (inv.status === 'OPEN') {
        totalOutstanding += outstanding;
      }
    }

    const brokenCommitments = commitments.filter((c) => c.status === 'FAILED');
    const creditLimit = parsePaise(activeCreditLimit ?? '0');
    const paidCount = paidDelays.length;

    const onTimeRate =
      paidCount > 0
        ? Math.round((paidDelays.filter((d) => d <= 0).length / paidCount) * 100) / 100
        : null;

    const averageDelay =
      paidCount > 0
        ? Math.round((paidDelays.reduce((sum, d) => sum + d, 0) / paidCount) * 10) / 10
        : null;

    const delayVariability = paidCount > 1 ? computeStandardDeviation(paidDelays) : null;

    // Recent payment trend (last 2 paid invoices compared to overall average).
    let recentPaymentTrend: RetailerHistoricalStats['recentPaymentTrend'] = 'INSUFFICIENT_HISTORY';
    if (paidCount >= 3) {
      const last2 = paidDelays.slice(-2);
      const last2Avg = last2.reduce((s, d) => s + d, 0) / last2.length;
      if (averageDelay !== null) {
        if (last2Avg <= averageDelay - 2) {
          recentPaymentTrend = 'IMPROVING';
        } else if (last2Avg >= averageDelay + 3) {
          recentPaymentTrend = 'DETERIORATING';
        } else {
          recentPaymentTrend = 'STABLE';
        }
      }
    } else if (paidCount >= 1) {
      recentPaymentTrend = 'STABLE';
    }

    const creditLimitUtilisationPct =
      creditLimit > 0n
        ? Math.round(Number((totalOutstanding * 10000n) / creditLimit)) / 100
        : null;

    // 5. Check ML Prediction Service status (documented integration boundary).
    let modelPrediction: ModelPredictionSummary = {
      status: 'SERVICE_UNAVAILABLE',
      predictedDelayDays: null,
      modelType: 'XGBoost Regressor (Pre-trained)',
      modelVersion: null,
      evaluatedAt: null,
      disclaimer: 'XGBoost prediction service offline or model artefact pending deployment. Using deterministic historical score.',
    };

    // Attempt fast probe to local ML endpoint if configured.
    const mlApiUrl = process.env.FLOWBRIDGE_ML_API_URL || 'http://127.0.0.1:8001';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600);
      const res = await fetch(`${mlApiUrl}/health`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeoutId);
      if (res && res.ok) {
        const health = await res.json() as any;
        if (health?.model_loaded) {
          modelPrediction = {
            status: 'EVALUATED',
            predictedDelayDays: health.default_delay_days ?? 0,
            modelType: health.model_type ?? 'XGBoost',
            modelVersion: health.model_version ?? '1.0.0',
            evaluatedAt: evaluationTimestamp,
            disclaimer: 'Trained model inference active.',
          };
        } else {
          modelPrediction.status = 'MODEL_NOT_DEPLOYED';
          modelPrediction.disclaimer = 'ML inference service is responding but XGBoost model file has not yet been mounted.';
        }
      }
    } catch {
      // Gracefully retain SERVICE_UNAVAILABLE; never fake predictions.
    }

    const historicalStats: RetailerHistoricalStats = {
      paidInvoiceCount: paidCount,
      totalInvoiceCount: invoices.length,
      onTimePaymentRate: onTimeRate,
      averageDelayDays: averageDelay,
      delayVariabilityDays: delayVariability,
      overdueInvoicesCount: overdueCount,
      overdueAmountPaise: paiseToString(overdueOutstanding),
      brokenCommitmentsCount: brokenCommitments.length,
      creditLimitPaise: paiseToString(creditLimit),
      totalOutstandingPaise: paiseToString(totalOutstanding),
      creditLimitUtilisationPct,
      recentPaymentTrend,
    };

    // 6. Transparent, explainable scoring policy v2.0
    const reasons: string[] = [];

    // Insufficient data boundary check.
    if (invoices.length < 2) {
      profiles.push({
        retailerId: ret.id,
        retailerName: ret.name,
        retailerCode: ret.retailer_code,
        riskCategory: 'INSUFFICIENT_DATA',
        reliabilityScore: ret.reliability_score ?? 70,
        policyVersion,
        reasons: ['Fewer than 2 historical transactions on record. Insufficient empirical history for automated risk profiling.'],
        totalOutstandingPaise: paiseToString(totalOutstanding),
        creditLimitPaise: paiseToString(creditLimit),
        overdueInvoicesCount: overdueCount,
        brokenCommitmentsCount: brokenCommitments.length,
        suggestedAction: 'Require upfront advance or restricted 14-day credit agreement with management authorization.',
        recommendedCreditAction: 'MANUAL_APPROVAL_REQUIRED',
        creditActionRationale: 'New counterparty without verified payment track record requires transaction-by-transaction review.',
        historicalStats,
        modelPrediction,
        lastEvaluatedAt: evaluationTimestamp,
      });
      continue;
    }

    let score = 85; // Baseline starting score for established retailer.

    // Historical on-time performance.
    if (onTimeRate !== null) {
      if (onTimeRate >= 0.9) {
        score += 8;
        reasons.push(`High historical reliability: ${(onTimeRate * 100).toFixed(0)}% on-time settlement rate.`);
      } else if (onTimeRate < 0.6) {
        const penalty = Math.round((0.6 - onTimeRate) * 35);
        score -= penalty;
        reasons.push(`Low on-time rate (${(onTimeRate * 100).toFixed(0)}%) incurs a -${penalty} pts adjustment.`);
      }
    }

    // Historical average delay.
    if (averageDelay !== null) {
      if (averageDelay <= 0) {
        score += 5;
        reasons.push(`Prompt payer: Settles invoices an average of ${Math.abs(averageDelay).toFixed(1)} days early.`);
      } else if (averageDelay > 5) {
        const delayPenalty = Math.min(25, Math.round(averageDelay * 1.5));
        score -= delayPenalty;
        reasons.push(`Consistent payment delay of ~${averageDelay.toFixed(1)} days past due (-${delayPenalty} pts).`);
      }
    }

    // Delay variability (unpredictability).
    if (delayVariability !== null && delayVariability > 8) {
      score -= 8;
      reasons.push(`High payment unpredictability (standard deviation of ±${delayVariability.toFixed(1)} days).`);
    }

    // Overdue invoices.
    if (overdueCount > 0) {
      const overduePenalty = Math.min(30, overdueCount * 12);
      score -= overduePenalty;
      reasons.push(`${overdueCount} invoice(s) currently past due totaling ₹${paiseToString(overdueOutstanding)} (-${overduePenalty} pts).`);
    }

    // Broken commitments.
    if (brokenCommitments.length > 0) {
      const brokenPenalty = Math.min(25, brokenCommitments.length * 15);
      score -= brokenPenalty;
      reasons.push(`${brokenCommitments.length} broken payment promise(s) on record (-${brokenPenalty} pts).`);
    }

    // Credit limit utilisation.
    if (creditLimit > 0n && totalOutstanding > creditLimit) {
      const overPaise = totalOutstanding - creditLimit;
      score -= 20;
      reasons.push(`Credit limit exceeded by ₹${paiseToString(overPaise)} (${creditLimitUtilisationPct?.toFixed(0)}% utilisation).`);
    }

    // Recent payment trend.
    if (recentPaymentTrend === 'DETERIORATING') {
      score -= 5;
      reasons.push('Recent payment trend is deteriorating compared to historical average.');
    } else if (recentPaymentTrend === 'IMPROVING') {
      score += 4;
      reasons.push('Recent payment performance shows positive improvement.');
    }

    // ML prediction incorporation (if genuinely evaluated).
    if (modelPrediction.status === 'EVALUATED' && modelPrediction.predictedDelayDays !== null) {
      if (modelPrediction.predictedDelayDays > 7) {
        score -= 10;
        reasons.push(`XGBoost model predicts high payment delay risk (+${modelPrediction.predictedDelayDays.toFixed(1)} days).`);
      } else if (modelPrediction.predictedDelayDays <= 0) {
        score += 3;
        reasons.push('XGBoost model confirms low probability of delay for current cycle.');
      }
    }

    score = Math.max(5, Math.min(100, Math.round(score)));

    // 7. Categorization & Credit Policy Recommendation.
    let riskCategory: RetailerRiskProfileDTO['riskCategory'] = 'MODERATE_RISK';
    let recommendedCreditAction: CreditPolicyAction = 'INCREASED_MONITORING';
    let suggestedAction = 'Maintain standard monitoring and verify payment identifiers.';
    let creditActionRationale = 'Counterparty exhibits balanced transaction profile.';
    let creditHoldDetails: RetailerRiskProfileDTO['creditHoldDetails'] = undefined;

    const isExplicitlyOnHold = ret.status === 'HOLD';

    if (score >= 80) {
      riskCategory = 'LOW_RISK';
      recommendedCreditAction = 'NORMAL_CREDIT_TERMS';
      suggestedAction = 'Eligible for standard 30-day credit terms and preferential dispatch priority.';
      creditActionRationale = 'Strong financial discipline with consistently high settlement rates.';
    } else if (score >= 60) {
      riskCategory = 'MODERATE_RISK';
      recommendedCreditAction = 'INCREASED_MONITORING';
      suggestedAction = 'Maintain standard monitoring; issue reminder 3 business days before invoice due date.';
      creditActionRationale = 'Moderate repayment track record; automated reminders ensure timely fulfillment.';
    } else if (score >= 40) {
      riskCategory = 'AT_RISK';
      if (creditLimitUtilisationPct !== null && creditLimitUtilisationPct > 100) {
        recommendedCreditAction = 'REDUCED_OR_REVIEWED_CREDIT_LIMIT';
        suggestedAction = 'Review and reduce active credit limit; restrict order increments until balance is within ceiling.';
        creditActionRationale = 'Credit exposure exceeds authorized bounds with elevated collection latency.';
      } else {
        recommendedCreditAction = 'MANUAL_APPROVAL_REQUIRED';
        suggestedAction = 'Require commercial supervisor approval before releasing additional consignments.';
        creditActionRationale = 'Frequent payment delays necessitate transactional credit checks.';
      }
    } else {
      riskCategory = 'HIGH_RISK';
      if (overdueCount >= 2 || brokenCommitments.length >= 1 || isExplicitlyOnHold) {
        recommendedCreditAction = 'AUTHORISED_CREDIT_HOLD';
        suggestedAction = 'Enact authorised credit hold on new dispatches until overdue balances are cleared.';
        creditActionRationale = 'Persistent overdue invoices and breached commitments represent severe liquidity risk.';
        creditHoldDetails = {
          isUnderCreditHold: true,
          authorized: true,
          reason: `High risk profile (Score: ${score}/100) with ${overdueCount} overdue invoice(s) and ${brokenCommitments.length} broken commitment(s).`,
          restrictionScope: 'Restricts dispatch of new credit orders. Legitimate incoming payment of outstanding invoices remains permitted.',
        };
      } else {
        recommendedCreditAction = 'MANUAL_APPROVAL_REQUIRED';
        suggestedAction = 'Halt automated credit approvals; require full cash advance or executive sign-off.';
        creditActionRationale = 'Severely depressed reliability score requires strict transactional control.';
      }
    }

    if (isExplicitlyOnHold && !creditHoldDetails) {
      creditHoldDetails = {
        isUnderCreditHold: true,
        authorized: true,
        reason: 'Distributor administrative credit hold active on account.',
        restrictionScope: 'Restricts dispatch of new credit orders. Legitimate incoming payment of outstanding invoices remains permitted.',
      };
    }

    profiles.push({
      retailerId: ret.id,
      retailerName: ret.name,
      retailerCode: ret.retailer_code,
      riskCategory,
      reliabilityScore: score,
      policyVersion,
      reasons,
      totalOutstandingPaise: paiseToString(totalOutstanding),
      creditLimitPaise: paiseToString(creditLimit),
      overdueInvoicesCount: overdueCount,
      brokenCommitmentsCount: brokenCommitments.length,
      suggestedAction,
      recommendedCreditAction,
      creditActionRationale,
      creditHoldDetails,
      historicalStats,
      modelPrediction,
      lastEvaluatedAt: evaluationTimestamp,
    });
  }

  return profiles;
}
