import { useState } from 'react';
import {
  addDays,
  formatINR,
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

  async function runPreset(label: string, actions: ScenarioActionInput[]) {
    setEvaluating(true);
    setLocalError(null);
    setScenarioLabel(label);
    setActiveActions(actions);
    try {
      const res = await onEvaluateScenario(actions);
      setScenarioForecast(res);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setEvaluating(false);
    }
  }

  function buildBlueprintPlanAActions(): ScenarioActionInput[] {
    const day0 = workspace.business.openingCashDate;
    const invA = workspace.invoices.find((i) => i.invoiceNumber === 'C-3301');
    const billA = workspace.bills.find((b) => b.billNumber === 'S-2041');
    const actions: ScenarioActionInput[] = [];
    if (invA) {
      actions.push({
        targetType: 'CUSTOMER_INVOICE',
        targetId: invA.id,
        targetLabel: `${invA.invoiceNumber} Early Receipt`,
        actionType: 'ACCELERATE_INFLOW',
        amountPaise: '2000000',
        originalDate: invA.dueDate,
        simulatedDate: addDays(day0, 4),
      });
    }
    if (billA) {
      actions.push({
        targetType: 'SUPPLIER_BILL',
        targetId: billA.id,
        targetLabel: `${billA.billNumber} Deferral`,
        actionType: 'DEFER_OUTFLOW',
        amountPaise: '2500000',
        originalDate: billA.dueDate,
        simulatedDate: addDays(day0, 12),
      });
    }
    return actions;
  }

  function buildCustomerBDelayShock(): ScenarioActionInput[] {
    const invB = workspace.invoices.find((i) => i.invoiceNumber === 'C-3307');
    if (!invB) return [];
    return [
      {
        targetType: 'CUSTOMER_INVOICE',
        targetId: invB.id,
        targetLabel: `${invB.invoiceNumber} Delayed 5 Days`,
        actionType: 'DELAY_INFLOW',
        amountPaise: invB.outstandingPaise,
        originalDate: invB.dueDate,
        simulatedDate: addDays(invB.dueDate, 5),
      },
    ];
  }

  function buildCollectionDropShock(): ScenarioActionInput[] {
    return [
      {
        targetType: 'SYNTHETIC_ADJUSTMENT',
        targetId: null,
        targetLabel: '20% Collection Drop Shockwave',
        actionType: 'DROP_INFLOW_PCT',
        amountPaise: '20',
        originalDate: null,
        simulatedDate: workspace.business.openingCashDate,
      },
    ];
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
                      runPreset(
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
            onClick={() => runPreset('Blueprint Plan A (Early ₹20k + Defer ₹25k)', buildBlueprintPlanAActions())}
          >
            Run Blueprint Plan A (+₹15k Day 5)
          </button>
          <button
            className="btn"
            disabled={isBusy}
            onClick={() => runPreset('Shockwave: Customer B Delays 5 Days', buildCustomerBDelayShock())}
          >
            Shockwave: Customer B Delays 5 Days
          </button>
          <button
            className="btn"
            disabled={isBusy}
            onClick={() => runPreset('Shockwave: 20% Collection Drop', buildCollectionDropShock())}
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
        ) : (
          <p className="muted">Select a preset above or compare any feasible plan to overlay its cash curve without mutating actuals.</p>
        )}
      </div>
    </div>
  );
}

