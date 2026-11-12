import { useEffect, useState } from 'react';
import { formatINR } from '@flowbridge/shared';
import type {
  CommitmentReconciliationResponse,
  VerificationPayload,
  WorkspacePayload,
} from '../api/client';
import { ClassificationBadge, StatusPill } from './Badge';
import { CashCurveChart } from './CashCurveChart';
import { BankSmsIngestion } from './BankSmsIngestion';

interface VerifyViewProps {
  workspace: WorkspacePayload;
  verification: VerificationPayload;
  onSimulateDelayRadar: (
    delays: Array<{ invoiceId: string; delayDays: number }>,
    asOfDate?: string,
  ) => Promise<VerificationPayload>;
  onReconcileCommitments: (options?: {
    asOfDate?: string;
    assumeBankDataComplete?: boolean;
  }) => Promise<CommitmentReconciliationResponse>;
  busy: boolean;
}

export function VerifyView({
  workspace,
  verification,
  onSimulateDelayRadar,
  onReconcileCommitments,
  busy,
}: VerifyViewProps) {
  const [radarResult, setRadarResult] = useState<VerificationPayload>(verification);
  const [reconcileReport, setReconcileReport] = useState<CommitmentReconciliationResponse | null>(null);
  const [evalAsOfDate, setEvalAsOfDate] = useState(verification.asOfDate);
  const [assumeBankComplete, setAssumeBankComplete] = useState(false);
  const [delayDays, setDelayDays] = useState(5);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setRadarResult(verification);
    setEvalAsOfDate(verification.asOfDate);
  }, [verification]);

  const isBusy = busy || localBusy;
  const custBInvoice = workspace.invoices.find((i) => i.invoiceNumber === 'C-3307');

  async function triggerCustomerBDelay() {
    if (!custBInvoice) return;
    setLocalError(null);
    setLocalBusy(true);
    try {
      const res = await onSimulateDelayRadar(
        [{ invoiceId: custBInvoice.id, delayDays }],
        evalAsOfDate || undefined,
      );
      setRadarResult(res);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function resetRadar() {
    setLocalError(null);
    setLocalBusy(true);
    try {
      const res = await onSimulateDelayRadar([], evalAsOfDate || undefined);
      setRadarResult(res);
      setReconcileReport(null);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function runReconciliation() {
    setLocalError(null);
    setLocalBusy(true);
    try {
      const report = await onReconcileCommitments({
        asOfDate: evalAsOfDate || undefined,
        assumeBankDataComplete: assumeBankComplete,
      });
      setReconcileReport(report);
      setRadarResult((prev) => ({
        ...prev,
        asOfDate: report.asOfDate,
        radar: report.radar,
      }));
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setLocalBusy(false);
    }
  }

  const replan = radarResult.radar.replanResult;

  return (
    <div>
      {localError && (
        <div className="banner banner-error">
          <div><strong>Verification / Radar Error:</strong> {localError}</div>
          <button className="btn btn-sm" onClick={() => setLocalError(null)}>✕</button>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi-card good">
          <div className="kpi-label">Verified Actual Inflows</div>
          <div className="kpi-value num">{formatINR(radarResult.totalVerifiedInflowsPaise)}</div>
          <div className="kpi-foot">Confirmed via bank import / matching</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pending Review Inflows</div>
          <div className="kpi-value num">{formatINR(radarResult.totalPendingReviewInflowsPaise)}</div>
          <div className="kpi-foot">Awaiting allocation confirmation or match review</div>
        </div>
        <div className={`kpi-card ${radarResult.radar.alerts.length > 0 ? 'danger' : ''}`}>
          <div className="kpi-label">Promise Failure Radar Alerts</div>
          <div className="kpi-value num">{radarResult.radar.alerts.length} Active Alert(s)</div>
          <div className="kpi-foot">
            Rerun Breach: {radarResult.radar.rerunForecast.breach.firstBreachDate ?? 'None'}
          </div>
        </div>
      </div>

      {/* Bank Data Completeness Banner */}
      <div className={`banner ${radarResult.radar.hasIncompleteBankData ? 'banner-warn' : 'banner-info'}`}>
        <div>
          <strong>Bank Feed Completeness (as of {radarResult.asOfDate}):</strong>{' '}
          {radarResult.radar.hasIncompleteBankData ? (
            <>
              Incomplete coverage (verified feed through{' '}
              <span className="code-pill">{radarResult.radar.bankDataCompleteThrough ?? 'None'}</span>
              {workspace.transactions.some(
                (t) =>
                  !t.isReversed &&
                  (t.matchStatus === 'UNMATCHED' ||
                    t.matchStatus === 'AMBIGUOUS' ||
                    t.verificationStatus === 'PENDING_REVIEW'),
              )
                ? ' with unmatched/pending payments in queue'
                : ''}
              ). Past-due commitments stay labelled{' '}
              <span className="code-pill">UNKNOWN_NEEDS_REVIEW</span> until bank data covers the due date.
            </>
          ) : (
            <>
              Verified bank data covers through{' '}
              <span className="code-pill">{radarResult.radar.bankDataCompleteThrough ?? radarResult.asOfDate}</span>.
              Unfulfilled past-due commitments are flagged <span className="code-pill">MISSED_COMMITMENT</span>.
            </>
          )}
        </div>
      </div>

      {/* Stage 5: Promise Failure Radar */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Stage 5 — VERIFY: Promise Failure Radar & Rerun Forecast</h2>
            <div className="muted">
              Detects missed commitments / delayed receipts and immediately reruns the cash forecast.
            </div>
          </div>
          <div className="controls-row">
            <label className="muted" style={{ fontSize: '0.8rem' }}>
              As-Of Date:{' '}
              <input
                type="date"
                value={evalAsOfDate}
                onChange={(e) => setEvalAsOfDate(e.target.value)}
                style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </label>
            <label className="muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 5 }}>
              <input
                type="checkbox"
                checked={assumeBankComplete}
                onChange={(e) => setAssumeBankComplete(e.target.checked)}
              />
              Assume bank complete
            </label>
            <button className="btn btn-primary" disabled={isBusy} onClick={runReconciliation}>
              Reconcile Commitments
            </button>
            {custBInvoice && (
              <>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={delayDays}
                  onChange={(e) => setDelayDays(Number(e.target.value))}
                  style={{ width: 64, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <button className="btn btn-danger" disabled={isBusy} onClick={triggerCustomerBDelay}>
                  Test Delay: {custBInvoice.invoiceNumber} +{delayDays}d
                </button>
              </>
            )}
            <button className="btn" disabled={isBusy} onClick={resetRadar}>
              Reset Radar
            </button>
          </div>
        </div>

        {radarResult.radar.alerts.length === 0 ? (
          <div className="banner banner-success">
            <div>No missed promises or active delay alerts as of {radarResult.asOfDate}.</div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {radarResult.radar.alerts.map((al, i) => (
              <div key={`${al.recordId}-${i}`} className="banner banner-error">
                <div>
                  <strong>{al.alertType}</strong> (<span className="code-pill">{al.referenceCode}</span>): {al.message}
                </div>
                <StatusPill status={al.alertType} />
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClassificationBadge type={radarResult.radar.rerunForecast.classification === 'SCENARIO_WHAT_IF' ? 'SCENARIO' : 'EXPECTED'} />
          <span className="muted">
            Lowest balance after radar rerun:{' '}
            <strong className="num">{formatINR(radarResult.radar.rerunForecast.breach.lowestBalancePaise)}</strong>{' '}
            on {radarResult.radar.rerunForecast.breach.lowestBalanceDate}
          </span>
        </div>

        <CashCurveChart
          days={radarResult.radar.rerunForecast.days}
          minimumCashPaise={radarResult.radar.rerunForecast.minimumCashPaise}
        />
      </div>

      {/* Latest Reconcile Output */}
      {reconcileReport && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Commitment Reconciliation Run ({reconcileReport.asOfDate})</h3>
              <div className="muted">
                Bank Data Through: {reconcileReport.bankDataCompleteThrough ?? 'None'} • Pending Unmatched:{' '}
                {reconcileReport.hasPendingUnmatched ? 'Yes' : 'No'}
              </div>
            </div>
            <StatusPill status={reconcileReport.hasPendingUnmatched ? 'UNKNOWN_NEEDS_REVIEW' : 'VERIFIED'} />
          </div>
          {reconcileReport.commitmentsReconciled.length === 0 ? (
            <p className="muted">No active commitments found for reconciliation.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Due Date</th>
                    <th>Expected</th>
                    <th>Fulfilled</th>
                    <th>Reconciliation Status</th>
                    <th>Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {reconcileReport.commitmentsReconciled.map((row) => (
                    <tr key={row.commitmentId}>
                      <td><strong>{row.actionType}</strong></td>
                      <td className="num">{row.dueDate}</td>
                      <td className="num">{formatINR(row.expectedAmountPaise)}</td>
                      <td className="num">{formatINR(row.fulfilledAmountPaise)}</td>
                      <td><StatusPill status={row.reconciliationStatus} /></td>
                      <td className="muted">{row.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Radar Auto-Replan / Emergency Fallback After Breach */}
      {replan && (radarResult.radar.alerts.length > 0 || radarResult.radar.rerunForecast.breach.firstBreachDate !== null) && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Revised Resolution Search After Disruption</h3>
              <div className="muted">
                Evaluated within distributor-approved search bounds against the updated forecast.
              </div>
            </div>
            <StatusPill status={replan.status} />
          </div>

          {replan.status === 'FEASIBLE_PLANS_FOUND' && replan.feasiblePlans.length > 0 ? (
            <div className="grid-2">
              {replan.feasiblePlans.map((plan) => (
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
                    <span className="badge badge-actual">
                      Lowest: {formatINR(plan.postActionLowestBalancePaise)}
                    </span>
                  </div>
                  <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: '0.85rem' }}>
                    {plan.actions.map((a) => (
                      <li key={a.id} style={{ marginBottom: 4 }}>
                        <span className="code-pill">{a.targetCode}</span> ({a.counterpartyName}):{' '}
                        <strong>{a.actionType === 'ACCELERATE_INFLOW' ? 'Early Request' : 'Defer Outflow'}</strong>{' '}
                        {formatINR(a.amountPaise)} ({a.originalDate} → {a.proposedDate})
                        <div className="muted">{a.limitExplanation}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="banner banner-error">
                <div>
                  <strong>EMERGENCY MODE FALLBACK:</strong> {replan.emergencySummary}
                </div>
                <StatusPill status="NO_FEASIBLE_PLAN" />
              </div>
              {replan.survivalModePriorities.length > 0 && (
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
                      {replan.survivalModePriorities.map((item) => (
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
              )}
            </div>
          )}
        </div>
      )}

      {/* Real Indian Bank SMS Transaction Ingestion */}
      <BankSmsIngestion businessId={workspace.business.id} />

      {/* Actual vs Plan Table */}
      <div className="card">
        <div className="card-header">
          <h3>Actual-vs-Plan Commitment Verification</h3>
        </div>
        {radarResult.actualVsPlan.length === 0 ? (
          <p className="muted">No commitments recorded yet to compare against actual inflows.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Expected Date</th>
                  <th>Expected Amount</th>
                  <th>Actual Fulfilled</th>
                  <th>Variance</th>
                  <th>Assessment</th>
                </tr>
              </thead>
              <tbody>
                {radarResult.actualVsPlan.map((row) => (
                  <tr key={row.commitmentId}>
                    <td><strong>{row.actionType}</strong></td>
                    <td><StatusPill status={row.status} /></td>
                    <td className="num">{row.expectedDate}</td>
                    <td className="num">{formatINR(row.expectedAmountPaise)}</td>
                    <td className="num">{formatINR(row.actualFulfilledPaise)}</td>
                    <td className="num">{formatINR(row.variancePaise)}</td>
                    <td><StatusPill status={row.assessment} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit Trail */}
      <div className="card">
        <div className="card-header">
          <h3>Immutable Audit Events (Recent 15)</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {workspace.auditEvents.slice(0, 15).map((ev) => (
                <tr key={ev.id}>
                  <td className="muted">{new Date(ev.createdAt).toLocaleString()}</td>
                  <td><span className="code-pill">{ev.eventType}</span></td>
                  <td>{ev.actor}</td>
                  <td>{ev.entityType}</td>
                  <td className="muted" style={{ fontSize: '0.78rem' }}>{JSON.stringify(ev.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

