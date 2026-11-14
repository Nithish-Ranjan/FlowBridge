import { useState, useRef } from 'react';
import {
  addDays,
  compareIsoDate,
  formatINR,
  parsePaise,
  paiseToString,
  validateScenarioActions,
  type ApprovalLimits,
  type ForecastResult,
  type ResolutionPlan,
  type ResolutionSearchResult,
  type ScenarioActionInput,
} from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';
import { ClassificationBadge, StatusPill } from './Badge';
import { CashCurveChart } from './CashCurveChart';

interface ResolveViewProps {
  workspace: WorkspacePayload;
  resolution: ResolutionSearchResult;
  onUpdateLimits: (limits: ApprovalLimits) => Promise<void>;
  onEvaluateScenario: (actions: ScenarioActionInput[]) => Promise<ForecastResult>;
  onSaveScenario: (name: string, kind: 'RESOLUTION_PLAN' | 'SHOCKWAVE_WHAT_IF', actions: ScenarioActionInput[]) => Promise<void>;
  onProposePlan: (plan: ResolutionPlan) => Promise<void>;
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
  busy,
}: ResolveViewProps) {
  const [limits, setLimits] = useState<ApprovalLimits>(workspace.business.approvalLimits);
  const [scenarioForecast, setScenarioForecast] = useState<ForecastResult | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState<string>('');
  const [activeActions, setActiveActions] = useState<ScenarioActionInput[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isBusy = busy || evaluating;
  const latestRequestIdRef = useRef<number>(0);

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
   * Preset 1: Dynamically generated from loaded business records and resolution candidates.
   * Leverages real open invoices and bills respecting approved limits and outstanding balances.
   */
  function buildBalancedResolutionPlanActions(): PresetGenerationResult {
    // If bounded resolution search discovered a feasible plan, leverage its verified candidate actions
    if (resolution.feasiblePlans.length > 0 && resolution.feasiblePlans[0].actions.length > 0) {
      const plan = resolution.feasiblePlans[0];
      const actions = plan.actions.map((a) => a.scenarioAction);
      return { actions };
    }

    const day0 = workspace.business.openingCashDate;
    const horizonEnd = addDays(day0, 15);
    const breachDate = resolution.baselineForecast.breach.firstBreachDate;
    const actions: ScenarioActionInput[] = [];

    // 1. Pick largest eligible open customer invoice (due after Day 0 within horizon)
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

    // 2. Pick primary eligible open supplier bill (due within horizon)
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

  return (
    <div>
      {localError && (
        <div className="banner banner-error">
          <div><strong>Scenario Evaluation Error:</strong> {localError}</div>
          <button className="btn btn-sm" onClick={() => setLocalError(null)}>✕</button>
        </div>
      )}

      {/* Distributor-Approved Limits & Liquidity Firewall */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Stage 3 — RESOLVE: Distributor-Approved Search Bounds & Liquidity Firewall</h2>
            <div className="muted">
              FlowBridge searches strictly within your policy limits and protects essential operating expenses.
            </div>
          </div>
          <StatusPill status={resolution.status} />
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
              <option value="true">Protected (Never Defer Essential)</option>
              <option value="false">Allow Deferral Under Review</option>
            </select>
          </div>
        </div>

        <div className="controls-row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" disabled={isBusy} onClick={() => onUpdateLimits(limits)}>
            Save Limits & Re-Search Bounded Plans
          </button>
          <span className="muted">
            Tip: Set Max Early % = 10 & Max Supplier Deferral % = 10 to test the Emergency / No-Feasible-Plan branch.
          </span>
        </div>
      </div>

      {/* Emergency / No-Feasible-Plan Branch */}
      {resolution.status === 'NO_FEASIBLE_PLAN' && (
        <div className="card" style={{ borderColor: '#fda4af', background: 'var(--rose-soft)' }}>
          <div className="card-header">
            <h3 style={{ color: 'var(--rose)' }}>EMERGENCY ESCALATION — NO FEASIBLE PLAN WITHIN LIMITS</h3>
            <StatusPill status="NO_FEASIBLE_PLAN" />
          </div>
          <p style={{ marginTop: 0 }}>{resolution.emergencySummary}</p>
          <h4>Survival Mode Payment Priority List</h4>
          <div
            className="table-wrap"
            style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 8 }}
          >
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
                    <td><span className="code-pill">{item.referenceCode}</span></td>
                    <td>{item.description}</td>
                    <td className="num">{item.dueDate}</td>
                    <td className="num">{formatINR(item.amountPaise)}</td>
                    <td><StatusPill status={item.recommendation} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Feasible Bounded Resolution Plans */}
      {resolution.feasiblePlans.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>
              Feasible Bounded Resolution Plans ({resolution.feasiblePlans.length} feasible across{' '}
              {resolution.totalCombinationsEvaluated} bounded grid combinations)
            </h3>
            <span className="muted">Proposals create PROPOSED commitments — never agreed until human records reply.</span>
          </div>
          <div className="grid-2">
            {resolution.feasiblePlans.map((plan) => (
              <div
                key={plan.planId}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                  background: 'var(--surface-alt)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong>{plan.label}</strong>
                  <span className="badge badge-actual">Lowest: {formatINR(plan.postActionLowestBalancePaise)}</span>
                </div>
                <ul style={{ margin: '0 0 10px 18px', padding: 0, fontSize: '0.85rem' }}>
                  {plan.actions.map((a) => (
                    <li key={a.id} style={{ marginBottom: 4 }}>
                      <span className="code-pill">{a.targetCode}</span> ({a.counterpartyName}):{' '}
                      <strong>{a.actionType === 'ACCELERATE_INFLOW' ? 'Early Request' : 'Defer Outflow'}</strong>{' '}
                      {formatINR(a.amountPaise)} ({a.originalDate} → {a.proposedDate})
                      <div className="muted">{a.limitExplanation}</div>
                    </li>
                  ))}
                </ul>
                <div className="controls-row">
                  <button
                    className="btn"
                    disabled={isBusy}
                    onClick={() =>
                      runScenario(
                        `Preview: ${plan.label}`,
                        plan.actions.map((a) => a.scenarioAction),
                      )
                    }
                  >
                    Compare in What-If Chart
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={isBusy}
                    onClick={() => onProposePlan(plan)}
                  >
                    Propose Plan (Requires Human Reply)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Isolated What-If & Shockwave Scenarios */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Isolated What-If & Shockwave Simulator</h3>
            <div className="muted">
              Simulations never mutate actual invoices, supplier bills, expenses, or bank transactions.
            </div>
          </div>
          <ClassificationBadge type="SCENARIO" />
        </div>

        <div className="controls-row" style={{ marginBottom: 14 }}>
          <button
            className="btn"
            disabled={isBusy}
            onClick={() => handleTriggerPreset('Balanced Resolution Lever', buildBalancedResolutionPlanActions)}
          >
            Run Balanced Resolution Lever (Inflow + Deferral)
          </button>
          <button
            className="btn"
            disabled={isBusy}
            onClick={() => handleTriggerPreset('Shockwave: Customer Delay (+5 Days)', buildCustomerDelayShockActions)}
          >
            Shockwave: Customer Delay (+5 Days)
          </button>
          <button
            className="btn"
            disabled={isBusy}
            onClick={() => handleTriggerPreset('Shockwave: 20% Collection Drop', buildCollectionDropShockActions)}
          >
            Shockwave: 20% Collection Drop
          </button>
          {scenarioForecast && activeActions.length > 0 && (
            <button
              className="btn btn-emerald"
              disabled={isBusy}
              onClick={() => onSaveScenario(scenarioLabel, 'SHOCKWAVE_WHAT_IF', activeActions)}
            >
              Save Scenario to DB
            </button>
          )}
        </div>

        {/* Loading state indicator */}
        {evaluating && (
          <div className="banner banner-info" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>⏳ Evaluating scenario forecast: <strong>{scenarioLabel}</strong>...</span>
          </div>
        )}

        {scenarioForecast ? (
          <div>
            <div className="banner banner-info">
              <div>
                <strong>{scenarioLabel}</strong> — Classification:{' '}
                <ClassificationBadge type="SCENARIO" /> • Lowest Balance:{' '}
                <strong className="num">{formatINR(scenarioForecast.breach.lowestBalancePaise)}</strong> •
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
          <p className="muted">Select a preset above or compare any feasible plan to overlay its cash curve without mutating actuals.</p>
        ) : null}
      </div>
    </div>
  );
}
