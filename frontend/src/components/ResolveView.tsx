import { useState, useRef } from 'react';
import {
  addDays,
  compareIsoDate,
  formatINR,
  parsePaise,
  paiseToString,
  validateScenarioActions,
  parseScenarioIntent,
  type ApprovalLimits,
  type CustomerInvoiceDTO,
  type ForecastResult,
  type ResolutionPlan,
  type ResolutionSearchResult,
  type ScenarioActionInput,
  type SupplierBillDTO,
} from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';
import type { TransferredScenario } from '../App';
import { ClassificationBadge, StatusPill } from './Badge';
import { CashCurveChart } from './CashCurveChart';
import {
  SlidersHorizontal,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Shield,
  Layers,
  HelpCircle,
} from 'lucide-react';

interface ResolveViewProps {
  workspace: WorkspacePayload;
  resolution: ResolutionSearchResult;
  onUpdateLimits: (limits: ApprovalLimits) => Promise<void>;
  onEvaluateScenario: (actions: ScenarioActionInput[]) => Promise<ForecastResult>;
  onSaveScenario: (name: string, kind: 'RESOLUTION_PLAN' | 'SHOCKWAVE_WHAT_IF', actions: ScenarioActionInput[]) => Promise<void>;
  onProposePlan: (plan: ResolutionPlan) => Promise<void>;
  onSimulateInWhatIf?: (scenario: TransferredScenario) => void;
  busy: boolean;
}

interface PresetGenerationResult {
  actions: ScenarioActionInput[];
  explanation?: string;
}

export function ResolveView({
  workspace,
  resolution,
  onUpdateLimits,
  onEvaluateScenario,
  onSaveScenario,
  onProposePlan,
  onSimulateInWhatIf,
  busy,
}: ResolveViewProps) {
  const [limits, setLimits] = useState<ApprovalLimits>(workspace.business.approvalLimits);
  const [scenarioForecast, setScenarioForecast] = useState<ForecastResult | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState<string>('');
  const [activeActions, setActiveActions] = useState<ScenarioActionInput[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Natural Language Intent State
  const [nlQuery, setNlQuery] = useState('');
  const [nlFeedback, setNlFeedback] = useState<{
    type: 'RESOLVED' | 'AMBIGUOUS' | 'UNKNOWN';
    message: string;
    category?: 'DELAY_RETAILER' | 'DEFER_SUPPLIER' | 'CHOOSE_RESOLUTION';
    actions?: ScenarioActionInput[];
    title?: string;
    subtitle?: string;
    candidateInvoices?: CustomerInvoiceDTO[];
    candidateBills?: SupplierBillDTO[];
    candidatePlans?: ResolutionPlan[];
    suggestedDays?: number;
  } | null>(null);

  // Ambiguous disambiguation form state
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [selectedBillId, setSelectedBillId] = useState('');
  const [selectedDays, setSelectedDays] = useState(5);

  const isBusy = busy || evaluating;
  const latestRequestIdRef = useRef<number>(0);

  const baselineBreach = resolution.baselineForecast.breach;
  const hasBreach = Boolean(baselineBreach.firstBreachDate);
  const minCashPaise = resolution.baselineForecast.minimumCashPaise;

  /**
   * Evaluates a scenario with strict state hygiene:
   * - Immediately clears old forecast and stale errors so outdated charts are never displayed
   * - Uses a request ID counter to prevent out-of-order race conditions
   * - Validates actions against business records and limits prior to submission
   * - Handles API errors gracefully and restores UI
   */
  async function runScenario(label: string, actions: ScenarioActionInput[]) {
    if (isBusy) return;

    if (!actions || actions.length === 0) {
      setLocalError(`Cannot evaluate scenario "${label}": No valid actions could be generated from current records.`);
      setScenarioForecast(null);
      return;
    }

    const validation = validateScenarioActions(actions, {
      invoices: workspace.invoices,
      bills: workspace.bills,
      expenses: workspace.expenses,
      asOfDate: workspace.business.openingCashDate,
      limits,
    });

    if (!validation.valid) {
      setLocalError(`Invalid scenario "${label}": ${validation.error}`);
      setScenarioForecast(null);
      return;
    }

    // 1. Clear previous scenario state immediately
    setScenarioForecast(null);
    setLocalError(null);
    setScenarioLabel(label);
    setActiveActions(actions);
    setEvaluating(true);

    const currentReqId = ++latestRequestIdRef.current;

    try {
      const res = await onEvaluateScenario(actions);
      if (currentReqId === latestRequestIdRef.current) {
        setScenarioForecast(res);
      }
    } catch (err: any) {
      if (currentReqId === latestRequestIdRef.current) {
        setLocalError(err.message || 'Failed to evaluate scenario forecast.');
        setScenarioForecast(null);
      }
    } finally {
      if (currentReqId === latestRequestIdRef.current) {
        setEvaluating(false);
      }
    }
  }

  /**
   * Hands off a scenario to the existing What-If Simulator with full context.
   */
  function handleNavigateToWhatIf(scenario: TransferredScenario) {
    if (onSimulateInWhatIf) {
      onSimulateInWhatIf(scenario);
    }
  }

  /**
   * Preset 1: Dynamically generated from loaded business records and resolution candidates.
   */
  function buildBalancedResolutionPlanActions(): PresetGenerationResult {
    if (resolution.feasiblePlans.length > 0 && resolution.feasiblePlans[0].actions.length > 0) {
      const plan = resolution.feasiblePlans[0];
      const actions = plan.actions.map((a) => a.scenarioAction);
      return { actions };
    }

    const day0 = workspace.business.openingCashDate;
    const horizonEnd = addDays(day0, 15);
    const breachDate = resolution.baselineForecast.breach.firstBreachDate;
    const actions: ScenarioActionInput[] = [];

    const eligibleInvoices = workspace.invoices
      .filter((inv) => {
        if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') return false;
        const out = parsePaise(inv.outstandingPaise);
        if (out <= 0n) return false;
        return compareIsoDate(inv.dueDate, day0) > 0;
      })
      .sort((a, b) => {
        const amtA = parsePaise(a.outstandingPaise);
        const amtB = parsePaise(b.outstandingPaise);
        return amtA > amtB ? -1 : amtA < amtB ? 1 : 0;
      });

    const eligibleBills = workspace.bills
      .filter((b) => {
        if (b.status === 'PAID' || b.status === 'CANCELLED') return false;
        const out = parsePaise(b.outstandingPaise);
        if (out <= 0n) return false;
        return compareIsoDate(b.dueDate, day0) >= 0;
      })
      .sort((a, b) => {
        const amtA = parsePaise(a.outstandingPaise);
        const amtB = parsePaise(b.outstandingPaise);
        return amtA > amtB ? -1 : amtA < amtB ? 1 : 0;
      });

    const primaryInv = eligibleInvoices[0];
    const primaryBill = eligibleBills[0];

    if (primaryInv) {
      const out = parsePaise(primaryInv.outstandingPaise);
      const maxPct = BigInt(Math.max(1, Math.min(100, limits.maxEarlyRequestPct)));
      const earlyAmt = (out * maxPct) / 100n;
      const finalEarlyAmt = earlyAmt > 0n ? earlyAmt : out;

      const targetEarlyDate =
        breachDate && compareIsoDate(breachDate, day0) > 0
          ? compareIsoDate(breachDate, primaryInv.dueDate) < 0
            ? addDays(breachDate, -1)
            : addDays(day0, 1)
          : addDays(day0, Math.min(3, Math.max(1, limits.maxEarlyDays)));

      const earlyDate =
        compareIsoDate(targetEarlyDate, primaryInv.dueDate) < 0 ? targetEarlyDate : addDays(primaryInv.dueDate, -1);
      const validEarlyDate = compareIsoDate(earlyDate, day0) >= 0 ? earlyDate : day0;

      if (compareIsoDate(validEarlyDate, primaryInv.dueDate) < 0) {
        actions.push({
          id: `auto-accelerate-${primaryInv.id}`,
          targetType: 'CUSTOMER_INVOICE',
          targetId: primaryInv.id,
          targetLabel: `${primaryInv.invoiceNumber} Early Receipt (${primaryInv.retailerName ?? 'Customer'})`,
          actionType: 'ACCELERATE_INFLOW',
          amountPaise: paiseToString(finalEarlyAmt),
          originalDate: primaryInv.dueDate,
          simulatedDate: validEarlyDate,
        });
      }
    }

    if (primaryBill) {
      const out = parsePaise(primaryBill.outstandingPaise);
      const maxDeferPct = BigInt(Math.max(1, Math.min(100, limits.defaultMaxSupplierDeferralPct)));
      const deferAmt = (out * maxDeferPct) / 100n;
      const finalDeferAmt = deferAmt > 0n ? deferAmt : out;

      const deferDays = Math.max(1, Math.min(14, limits.defaultMaxSupplierDeferralDays));
      const targetDeferDate = addDays(primaryBill.dueDate, deferDays);
      const finalDeferDate = compareIsoDate(targetDeferDate, horizonEnd) <= 0 ? targetDeferDate : horizonEnd;

      if (compareIsoDate(finalDeferDate, primaryBill.dueDate) > 0) {
        actions.push({
          id: `auto-defer-${primaryBill.id}`,
          targetType: 'SUPPLIER_BILL',
          targetId: primaryBill.id,
          targetLabel: `${primaryBill.billNumber} Deferral (${primaryBill.supplierName ?? 'Supplier'})`,
          actionType: 'DEFER_OUTFLOW',
          amountPaise: paiseToString(finalDeferAmt),
          originalDate: primaryBill.dueDate,
          simulatedDate: finalDeferDate,
        });
      }
    }

    if (actions.length === 0) {
      return {
        actions: [],
        explanation: 'No open, eligible customer invoices or supplier bills found in current business records to generate a balanced resolution plan.',
      };
    }

    return { actions };
  }

  /**
   * Preset 2: Dynamically finds the largest open customer receivable to stress-test payment delay.
   */
  function buildCustomerDelayShockActions(): PresetGenerationResult {
    const day0 = workspace.business.openingCashDate;
    const eligibleInvoices = workspace.invoices
      .filter((inv) => {
        if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') return false;
        const out = parsePaise(inv.outstandingPaise);
        if (out <= 0n) return false;
        return compareIsoDate(inv.dueDate, day0) >= 0;
      })
      .sort((a, b) => {
        const amtA = parsePaise(a.outstandingPaise);
        const amtB = parsePaise(b.outstandingPaise);
        return amtA > amtB ? -1 : amtA < amtB ? 1 : a.dueDate.localeCompare(b.dueDate);
      });

    const topInv = eligibleInvoices[0];
    if (!topInv) {
      return {
        actions: [],
        explanation: 'No open customer invoices available in current business records to simulate a customer payment delay.',
      };
    }

    return {
      actions: [
        {
          id: `shock-delay-${topInv.id}`,
          targetType: 'CUSTOMER_INVOICE',
          targetId: topInv.id,
          targetLabel: `${topInv.invoiceNumber} (${topInv.retailerName ?? 'Customer'}) Delayed 5 Days`,
          actionType: 'DELAY_INFLOW',
          amountPaise: topInv.outstandingPaise,
          originalDate: topInv.dueDate,
          simulatedDate: addDays(topInv.dueDate, 5),
        },
      ],
    };
  }

  /**
   * Preset 3: Simulates a 20% collection drop across uncollected customer receivables.
   */
  function buildCollectionDropShockActions(): PresetGenerationResult {
    const day0 = workspace.business.openingCashDate;
    const hasOpenReceivables = workspace.invoices.some(
      (inv) =>
        inv.status !== 'PAID' &&
        inv.status !== 'CANCELLED' &&
        inv.status !== 'WRITTEN_OFF' &&
        parsePaise(inv.outstandingPaise) > 0n,
    );

    if (!hasOpenReceivables) {
      return {
        actions: [],
        explanation: 'No open customer receivables exist in current business records to apply a market collection reduction shockwave.',
      };
    }

    return {
      actions: [
        {
          id: 'shock-drop-20pct',
          targetType: 'SYNTHETIC_ADJUSTMENT',
          targetId: null,
          targetLabel: '20% Market Collection Drop Shockwave',
          actionType: 'DROP_INFLOW_PCT',
          amountPaise: '20',
          originalDate: null,
          simulatedDate: day0,
        },
      ],
    };
  }

  function handleTriggerPreset(label: string, generator: () => PresetGenerationResult) {
    const res = generator();
    if (!res.actions || res.actions.length === 0) {
      setLocalError(res.explanation || `No valid actions available for "${label}".`);
      setScenarioForecast(null);
      return;
    }
    runScenario(label, res.actions);
  }

  // Handle Natural Language Intent
  function handleEvaluateNlQuery(queryText: string) {
    setLocalError(null);
    const parsed = parseScenarioIntent(queryText, {
      invoices: workspace.invoices,
      bills: workspace.bills,
      asOfDate: workspace.business.openingCashDate,
      feasiblePlans: resolution.feasiblePlans,
    });

    if (parsed.type === 'RESOLVED') {
      setNlFeedback({
        type: 'RESOLVED',
        message: parsed.explanation,
        title: parsed.title,
        subtitle: parsed.subtitle,
        actions: parsed.actions,
      });
    } else if (parsed.type === 'AMBIGUOUS') {
      setNlFeedback({
        type: 'AMBIGUOUS',
        message: parsed.message,
        category: parsed.category,
        candidateInvoices: parsed.candidateInvoices,
        candidateBills: parsed.candidateBills,
        candidatePlans: parsed.candidatePlans,
        suggestedDays: parsed.suggestedDays || 5,
      });
      if (parsed.candidateInvoices && parsed.candidateInvoices.length > 0) {
        setSelectedInvoiceId(parsed.candidateInvoices[0].id);
      }
      if (parsed.candidateBills && parsed.candidateBills.length > 0) {
        setSelectedBillId(parsed.candidateBills[0].id);
      }
      setSelectedDays(parsed.suggestedDays || 5);
    } else {
      setNlFeedback({
        type: 'UNKNOWN',
        message: parsed.message,
      });
    }
  }

  function handleExecuteDisambiguatedNl() {
    if (!nlFeedback || nlFeedback.type !== 'AMBIGUOUS') return;

    if (nlFeedback.category === 'DELAY_RETAILER') {
      const inv = workspace.invoices.find((i) => i.id === selectedInvoiceId);
      if (!inv) {
        setLocalError('Selected invoice not found in current records.');
        return;
      }
      const days = Number(selectedDays) || 5;
      const simDate = addDays(inv.dueDate, days);
      const actions: ScenarioActionInput[] = [
        {
          id: `nl-delay-${inv.id}`,
          targetType: 'CUSTOMER_INVOICE',
          targetId: inv.id,
          targetLabel: `${inv.invoiceNumber} (${inv.retailerName ?? 'Retailer'}) Delayed ${days}D`,
          actionType: 'DELAY_INFLOW',
          amountPaise: inv.outstandingPaise,
          originalDate: inv.dueDate,
          simulatedDate: simDate,
        },
      ];

      handleNavigateToWhatIf({
        title: `What-If: ${inv.retailerName ?? inv.retailerCode} Delayed ${days} Days`,
        subtitle: `Invoice ${inv.invoiceNumber} settlement shifted from ${inv.dueDate} to ${simDate}`,
        source: 'NATURAL_LANGUAGE',
        actions,
      });
    } else if (nlFeedback.category === 'DEFER_SUPPLIER') {
      const bill = workspace.bills.find((b) => b.id === selectedBillId);
      if (!bill) {
        setLocalError('Selected supplier bill not found in current records.');
        return;
      }
      const days = Number(selectedDays) || 7;
      const simDate = addDays(bill.dueDate, days);
      const actions: ScenarioActionInput[] = [
        {
          id: `nl-defer-${bill.id}`,
          targetType: 'SUPPLIER_BILL',
          targetId: bill.id,
          targetLabel: `${bill.billNumber} (${bill.supplierName ?? 'Supplier'}) Deferred ${days}D`,
          actionType: 'DEFER_OUTFLOW',
          amountPaise: bill.outstandingPaise,
          originalDate: bill.dueDate,
          simulatedDate: simDate,
        },
      ];

      handleNavigateToWhatIf({
        title: `What-If: ${bill.supplierName ?? bill.supplierCode} Deferred ${days} Days`,
        subtitle: `Bill ${bill.billNumber} payment shifted from ${bill.dueDate} to ${simDate}`,
        source: 'NATURAL_LANGUAGE',
        actions,
      });
    } else if (nlFeedback.category === 'CHOOSE_RESOLUTION' && resolution.feasiblePlans.length > 0) {
      const plan = resolution.feasiblePlans[0];
      handleNavigateToWhatIf({
        title: `Simulated Resolution: ${plan.label}`,
        subtitle: 'Transferred directly from Resolution Autopilot recommended plan',
        source: 'RESOLUTION_AUTOPILOT',
        actions: plan.actions.map((a) => a.scenarioAction),
        planId: plan.planId,
      });
    }
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {localError && (
        <div className="banner banner-error">
          <div>
            <strong>Scenario Evaluation Error:</strong> {localError}
          </div>
          <button className="btn btn-sm" onClick={() => setLocalError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* ── STAGE 1: UNDERSTAND ── */}
      <div className="card" style={{ borderLeft: '4px solid var(--primary)', background: 'var(--surface)' }}>
        <div className="card-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  background: 'var(--primary-soft)',
                  color: 'var(--primary)',
                  padding: '2px 8px',
                  borderRadius: 12,
                  letterSpacing: '0.04em',
                }}
              >
                STAGE 1
              </span>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }}>
                UNDERSTAND: Cash-Flow Problem & Deficit Diagnostic
              </h2>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              FlowBridge continuously forecasts closing cash positions to detect upcoming timing mismatches between collections and obligations.
            </div>
          </div>
          <StatusPill status={hasBreach ? 'DEFICIT_DETECTED' : 'HEALTHY_FLOW'} />
        </div>

        {/* Deficit Diagnostic Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
            marginTop: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              background: hasBreach ? 'var(--rose-soft)' : 'var(--green-soft)',
              border: `1px solid ${hasBreach ? 'var(--rose-border)' : 'var(--green-border)'}`,
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Projected Liquidity Status
            </div>
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: hasBreach ? 'var(--rose)' : 'var(--green)',
                marginTop: 4,
              }}
            >
              {hasBreach ? 'Cash Shortage Detected' : 'Operating Cash Healthy'}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {hasBreach
                ? `First shortage occurs on ${baselineBreach.firstBreachDate} (Day ${baselineBreach.firstBreachDayIndex})`
                : 'No liquidity breach projected in forecast horizon'}
            </div>
          </div>

          <div
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Peak Shortfall Below Floor
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: hasBreach ? 'var(--rose)' : 'var(--text)', marginTop: 4 }}>
              {hasBreach ? formatINR(baselineBreach.shortfallPaise) : '₹0'}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Minimum Cash Threshold: {formatINR(minCashPaise)}
            </div>
          </div>

          <div
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Projected Lowest Balance
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>
              {formatINR(baselineBreach.lowestBalancePaise)}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Opening Cash: {formatINR(resolution.baselineForecast.openingCashPaise)}
            </div>
          </div>
        </div>

        {/* Root Cause Context */}
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            fontSize: '0.82rem',
            color: 'var(--text)',
            lineHeight: 1.5,
          }}
        >
          <strong>Root Cause Diagnostic: </strong>
          {hasBreach ? (
            <>
              Operating obligations mature on or before <strong>{baselineBreach.firstBreachDate}</strong> before expected retailer collections arrive in bank accounts. The Resolution Autopilot has identified targeted, low-friction levers to bridge this timing gap without taking expensive external debt.
            </>
          ) : (
            'Incoming receivables are scheduled to cover all upcoming payables and expenses comfortably above your minimum operating buffer.'
          )}
        </div>

        {/* Distributor-Approved Search Bounds Accordion / Form */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', fontWeight: 700 }}>
              <Shield size={16} color="var(--primary)" />
              <span>Distributor-Approved Policy Bounds & Liquidity Firewall</span>
            </div>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Controls the boundary within which Autopilot can propose solutions
            </span>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Max Early Collection Request (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={limits.maxEarlyRequestPct}
                onChange={(e) => setLimits({ ...limits, maxEarlyRequestPct: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Max Early Days Window</label>
              <input
                type="number"
                min={0}
                max={60}
                value={limits.maxEarlyDays}
                onChange={(e) => setLimits({ ...limits, maxEarlyDays: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Max Supplier Deferral (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={limits.defaultMaxSupplierDeferralPct}
                onChange={(e) =>
                  setLimits({ ...limits, defaultMaxSupplierDeferralPct: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Max Supplier Deferral Days</label>
              <input
                type="number"
                min={0}
                max={60}
                value={limits.defaultMaxSupplierDeferralDays}
                onChange={(e) =>
                  setLimits({ ...limits, defaultMaxSupplierDeferralDays: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Liquidity Firewall (Essential Expenses)</label>
              <select
                value={limits.protectEssentialExpenses ? 'true' : 'false'}
                onChange={(e) =>
                  setLimits({ ...limits, protectEssentialExpenses: e.target.value === 'true' })
                }
              >
                <option value="true">Protected (Never Defer Essential Expenses)</option>
                <option value="false">Allow Deferral Under Review</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <button className="btn btn-sm btn-primary" disabled={isBusy} onClick={() => onUpdateLimits(limits)}>
              Save Limits & Re-Search Bounded Plans
            </button>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Tip: Tightening limits below 15% triggers the Emergency Escalation branch.
            </span>
          </div>
        </div>
      </div>

      {/* ── STAGE 2: RECOMMEND ── */}
      <div className="card" style={{ borderLeft: '4px solid var(--primary)', background: 'var(--surface)' }}>
        <div className="card-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  background: 'var(--primary-soft)',
                  color: 'var(--primary)',
                  padding: '2px 8px',
                  borderRadius: 12,
                  letterSpacing: '0.04em',
                }}
              >
                STAGE 2
              </span>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }}>
                RECOMMEND: Feasible Bounded Resolution Options & Trade-offs
              </h2>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Autopilot evaluated {resolution.totalCombinationsEvaluated} combinations within your approved boundaries to construct zero-breach plans.
            </div>
          </div>
          <StatusPill status={resolution.status} />
        </div>

        {/* Emergency Escalation if No Plan Feasible */}
        {resolution.status === 'NO_FEASIBLE_PLAN' && (
          <div
            style={{
              padding: 20,
              borderRadius: 12,
              background: 'var(--rose-soft)',
              border: '1px solid var(--rose-border)',
              marginTop: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <AlertTriangle size={20} color="var(--rose)" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--rose)', fontWeight: 800 }}>
                EMERGENCY ESCALATION — NO FEASIBLE PLAN WITHIN STRICT LIMITS
              </h3>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '0.84rem', color: 'var(--text)' }}>
              {resolution.emergencySummary}
            </p>
            <h4 style={{ margin: '0 0 8px', fontSize: '0.88rem' }}>Survival Mode Outflow Priority Ranking</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Record</th>
                    <th>Description</th>
                    <th>Due</th>
                    <th>Amount</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {resolution.survivalModePriorities.map((item) => (
                    <tr key={item.id}>
                      <td className="num">P{item.rank}</td>
                      <td>
                        <span className="code-pill">{item.referenceCode}</span>
                      </td>
                      <td>{item.description}</td>
                      <td className="num">{item.dueDate}</td>
                      <td className="num">{formatINR(item.amountPaise)}</td>
                      <td>
                        <StatusPill status={item.recommendation} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                className="btn btn-primary"
                onClick={() =>
                  handleNavigateToWhatIf({
                    title: 'Emergency Survival Mode Scenario',
                    subtitle: 'Model aggressive supplier deferrals and reserve drawdown to bridge cash deficit',
                    source: 'PRESET',
                    actions: buildBalancedResolutionPlanActions().actions,
                  })
                }
              >
                <SlidersHorizontal size={16} /> Simulate Emergency Sandbox in What-If →
              </button>
            </div>
          </div>
        )}

        {/* Feasible Plans List */}
        {resolution.feasiblePlans.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
            {resolution.feasiblePlans.map((plan, idx) => (
              <div
                key={plan.planId}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 20,
                  background: 'var(--surface)',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{plan.label}</strong>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Fragility Score: {plan.fragilityScore}/5 • {plan.humanApprovalNote}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        background: 'var(--green-soft)',
                        color: 'var(--green)',
                        border: '1px solid var(--green-border)',
                      }}
                    >
                      Lowest Balance: {formatINR(plan.postActionLowestBalancePaise)}
                    </span>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                        border: '1px solid var(--primary-border)',
                      }}
                    >
                      Cash Shifted: {formatINR(plan.totalCashShiftedPaise)}
                    </span>
                  </div>
                </div>

                {/* Action Items List */}
                <div
                  style={{
                    background: 'var(--surface-alt)',
                    borderRadius: 8,
                    padding: '12px 16px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Proposed Resolution Levers ({plan.actions.length} Lever{plan.actions.length > 1 ? 's' : ''}):
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {plan.actions.map((a) => (
                      <li key={a.id}>
                        <span className="code-pill">{a.targetCode}</span> (<strong>{a.counterpartyName}</strong>):{' '}
                        <span style={{ color: a.actionType === 'ACCELERATE_INFLOW' ? 'var(--green)' : 'var(--primary)', fontWeight: 700 }}>
                          {a.actionType === 'ACCELERATE_INFLOW' ? 'Accelerate Customer Inflow' : 'Defer Supplier Outflow'}
                        </span>{' '}
                        of <strong>{formatINR(a.amountPaise)}</strong> from {a.originalDate} →{' '}
                        <strong style={{ color: 'var(--text)' }}>{a.proposedDate}</strong>.
                        <span style={{ marginLeft: 6, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          ({a.limitExplanation})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Primary Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* Primary Simulation CTA leading to What-If */}
                    <button
                      className="btn btn-primary"
                      disabled={isBusy}
                      onClick={() =>
                        handleNavigateToWhatIf({
                          title: `Simulated Resolution: ${plan.label}`,
                          subtitle: `Transferred directly from Resolution Autopilot (${plan.actions.length} action${plan.actions.length > 1 ? 's' : ''})`,
                          source: 'RESOLUTION_AUTOPILOT',
                          actions: plan.actions.map((a) => a.scenarioAction),
                          planId: plan.planId,
                          notes: plan.humanApprovalNote,
                        })
                      }
                      style={{
                        padding: '9px 18px',
                        fontSize: '0.88rem',
                        fontWeight: 700,
                        boxShadow: 'var(--shadow-sm)',
                      }}
                    >
                      <SlidersHorizontal size={16} /> Simulate this resolution in What-If →
                    </button>

                    <button
                      className="btn"
                      disabled={isBusy}
                      onClick={() =>
                        runScenario(
                          `Preview: ${plan.label}`,
                          plan.actions.map((a) => a.scenarioAction),
                        )
                      }
                      style={{ fontSize: '0.84rem' }}
                    >
                      Preview in In-Page Chart
                    </button>
                  </div>

                  <button
                    className="btn btn-emerald"
                    disabled={isBusy}
                    onClick={() => onProposePlan(plan)}
                    style={{ fontSize: '0.84rem' }}
                  >
                    🤝 Propose Plan (Requires Human Reply)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── STAGE 3: SIMULATE ── */}
      <div className="card" style={{ borderLeft: '4px solid var(--primary)', background: 'var(--surface)' }}>
        <div className="card-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  background: 'var(--primary-soft)',
                  color: 'var(--primary)',
                  padding: '2px 8px',
                  borderRadius: 12,
                  letterSpacing: '0.04em',
                }}
              >
                STAGE 3
              </span>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }}>
                SIMULATE: Stress-Test Scenarios & Natural-Language Intent
              </h2>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Challenge the autopilot recommendations or test unexpected business shocks before committing. Simulations run strictly in sandbox memory without mutating ledgers.
            </div>
          </div>
          <ClassificationBadge type="SCENARIO" />
        </div>

        {/* Natural Language Scenario Prompt Bar */}
        <div
          style={{
            padding: 18,
            borderRadius: 12,
            background: 'linear-gradient(180deg, #FFFFFF 0%, var(--surface-alt) 100%)',
            border: '1px solid var(--border)',
            marginTop: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Sparkles size={18} color="var(--primary)" />
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text)' }}>
              Natural Language Scenario Assistant
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder='e.g., "What if this retailer pays late?", "What if I delay this supplier payment?", or "Simulate a 20% collection drop"'
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleEvaluateNlQuery(nlQuery);
                }
              }}
              style={{
                flex: 1,
                minWidth: 280,
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: '0.88rem',
              }}
            />
            <button
              className="btn btn-primary"
              onClick={() => handleEvaluateNlQuery(nlQuery)}
              style={{ padding: '10px 20px', fontWeight: 700 }}
            >
              Parse & Guide →
            </button>
          </div>

          {/* Quick Query Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>Try queries:</span>
            {[
              'What if this retailer pays late?',
              'What if I delay this supplier payment?',
              'Simulate a 20% collection drop.',
              'What happens if I choose this resolution?',
            ].map((chip) => (
              <button
                key={chip}
                onClick={() => {
                  setNlQuery(chip);
                  handleEvaluateNlQuery(chip);
                }}
                className="btn btn-sm"
                style={{
                  fontSize: '0.74rem',
                  background: 'var(--surface)',
                  borderRadius: 14,
                  padding: '3px 10px',
                  border: '1px solid var(--border)',
                }}
              >
                "{chip}"
              </button>
            ))}
          </div>

          {/* Natural Language Assistant Feedback / Disambiguation Box */}
          {nlFeedback && (
            <div
              style={{
                marginTop: 14,
                padding: 16,
                borderRadius: 10,
                background:
                  nlFeedback.type === 'RESOLVED'
                    ? 'var(--green-soft)'
                    : nlFeedback.type === 'AMBIGUOUS'
                    ? 'var(--amber-soft)'
                    : 'var(--rose-soft)',
                border: `1px solid ${
                  nlFeedback.type === 'RESOLVED'
                    ? 'var(--green-border)'
                    : nlFeedback.type === 'AMBIGUOUS'
                    ? 'var(--amber-border)'
                    : 'var(--rose-border)'
                }`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {nlFeedback.type === 'RESOLVED' && <CheckCircle2 size={20} color="var(--green)" />}
                {nlFeedback.type === 'AMBIGUOUS' && <HelpCircle size={20} color="var(--amber)" />}
                {nlFeedback.type === 'UNKNOWN' && <AlertTriangle size={20} color="var(--rose)" />}

                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 4 }}>
                    {nlFeedback.type === 'RESOLVED'
                      ? nlFeedback.title
                      : nlFeedback.type === 'AMBIGUOUS'
                      ? 'Clarification Needed'
                      : 'Scenario Intent Unclear'}
                  </strong>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text)' }}>
                    {nlFeedback.message}
                  </p>

                  {/* Ambiguous Disambiguation Form Controls */}
                  {nlFeedback.type === 'AMBIGUOUS' && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      {nlFeedback.category === 'DELAY_RETAILER' && nlFeedback.candidateInvoices && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Retailer Invoice:</label>
                          <select
                            value={selectedInvoiceId}
                            onChange={(e) => setSelectedInvoiceId(e.target.value)}
                            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                          >
                            {nlFeedback.candidateInvoices.map((inv) => (
                              <option key={inv.id} value={inv.id}>
                                {inv.retailerName ?? inv.retailerCode} ({inv.invoiceNumber}) — {formatINR(inv.outstandingPaise)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {nlFeedback.category === 'DEFER_SUPPLIER' && nlFeedback.candidateBills && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Supplier Bill:</label>
                          <select
                            value={selectedBillId}
                            onChange={(e) => setSelectedBillId(e.target.value)}
                            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                          >
                            {nlFeedback.candidateBills.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.supplierName ?? b.supplierCode} ({b.billNumber}) — {formatINR(b.outstandingPaise)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Days:</label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={selectedDays}
                          onChange={(e) => setSelectedDays(Number(e.target.value))}
                          style={{ width: 64, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                        />
                      </div>

                      <button
                        className="btn btn-sm btn-primary"
                        onClick={handleExecuteDisambiguatedNl}
                        style={{ padding: '7px 14px', fontWeight: 700 }}
                      >
                        <SlidersHorizontal size={14} /> Open & Test in What-If Simulator →
                      </button>
                    </div>
                  )}

                  {/* Resolved Action CTA */}
                  {nlFeedback.type === 'RESOLVED' && nlFeedback.actions && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() =>
                          handleNavigateToWhatIf({
                            title: nlFeedback.title || 'Natural Language What-If Scenario',
                            subtitle: nlFeedback.subtitle || 'Transferred from Natural Language Assistant',
                            source: 'NATURAL_LANGUAGE',
                            actions: nlFeedback.actions!,
                          })
                        }
                        style={{ padding: '7px 14px', fontWeight: 700 }}
                      >
                        <SlidersHorizontal size={14} /> Simulate this scenario in What-If Simulator →
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => runScenario(nlFeedback.title || 'NL Scenario', nlFeedback.actions!)}
                      >
                        Preview in In-Page Chart
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Shockwave & Preset Quick Launch Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            className="btn btn-primary"
            disabled={isBusy}
            onClick={() => {
              const res = buildBalancedResolutionPlanActions();
              if (res.actions.length > 0) {
                handleNavigateToWhatIf({
                  title: 'Balanced Resolution Lever (Inflow + Deferral)',
                  subtitle: 'Simulates early collection paired with supplier payment deferral',
                  source: 'PRESET',
                  actions: res.actions,
                });
              } else {
                setLocalError(res.explanation || 'No valid actions found.');
              }
            }}
          >
            <SlidersHorizontal size={15} /> What-If: Balanced Resolution Levers
          </button>

          <button
            className="btn"
            disabled={isBusy}
            onClick={() => {
              const res = buildCustomerDelayShockActions();
              if (res.actions.length > 0) {
                handleNavigateToWhatIf({
                  title: 'Shockwave: Customer Delay (+5 Days)',
                  subtitle: 'Simulates largest customer delaying settlement by 5 days',
                  source: 'PRESET',
                  actions: res.actions,
                });
              } else {
                setLocalError(res.explanation || 'No valid actions found.');
              }
            }}
          >
            <SlidersHorizontal size={15} /> What-If: Customer Delay (+5 Days)
          </button>

          <button
            className="btn"
            disabled={isBusy}
            onClick={() => {
              const res = buildCollectionDropShockActions();
              if (res.actions.length > 0) {
                handleNavigateToWhatIf({
                  title: 'Shockwave: 20% Market Collection Drop',
                  subtitle: 'Simulates a 20% systemic drop across uncollected customer receivables',
                  source: 'PRESET',
                  actions: res.actions,
                });
              } else {
                setLocalError(res.explanation || 'No valid actions found.');
              }
            }}
          >
            <SlidersHorizontal size={15} /> What-If: 20% Collection Drop
          </button>
        </div>

        {/* Local In-Page Preview Controls */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Or preview scenario curves inline without leaving Autopilot:
          </div>
          <div className="controls-row" style={{ marginBottom: 14 }}>
            <button
              className="btn btn-sm"
              disabled={isBusy}
              onClick={() => handleTriggerPreset('Balanced Resolution Lever', buildBalancedResolutionPlanActions)}
            >
              Preview Balanced Lever
            </button>
            <button
              className="btn btn-sm"
              disabled={isBusy}
              onClick={() => handleTriggerPreset('Shockwave: Customer Delay (+5 Days)', buildCustomerDelayShockActions)}
            >
              Preview Customer Delay (+5D)
            </button>
            <button
              className="btn btn-sm"
              disabled={isBusy}
              onClick={() => handleTriggerPreset('Shockwave: 20% Collection Drop', buildCollectionDropShockActions)}
            >
              Preview 20% Collection Drop
            </button>
            {scenarioForecast && activeActions.length > 0 && (
              <button
                className="btn btn-sm btn-emerald"
                disabled={isBusy}
                onClick={() => onSaveScenario(scenarioLabel, 'SHOCKWAVE_WHAT_IF', activeActions)}
              >
                Save Scenario to DB
              </button>
            )}
          </div>

          {evaluating && (
            <div className="banner banner-info" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>⏳ Evaluating scenario forecast: <strong>{scenarioLabel}</strong>...</span>
            </div>
          )}

          {scenarioForecast ? (
            <div>
              <div className="banner banner-info" style={{ marginBottom: 14 }}>
                <div>
                  <strong>{scenarioLabel}</strong> — Classification: <ClassificationBadge type="SCENARIO" /> •
                  Lowest Balance: <strong className="num">{formatINR(scenarioForecast.breach.lowestBalancePaise)}</strong> •
                  First Breach: <strong>{scenarioForecast.breach.firstBreachDate ?? 'None (Resolved!)'}</strong>
                </div>
              </div>
              <CashCurveChart
                days={resolution.baselineForecast.days}
                minimumCashPaise={resolution.baselineForecast.minimumCashPaise}
                comparisonDays={scenarioForecast.days}
                comparisonLabel={scenarioLabel}
              />
            </div>
          ) : !evaluating ? (
            <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
              Select a preview above or click any What-If action to transfer the scenario into the full What-If Financial Control Room.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
