import { useState } from 'react';
import { formatINR, parsePaise, type ForecastResult } from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';
import { ClassificationBadge, StatusPill } from './Badge';
import { CashCurveChart } from './CashCurveChart';

interface ForecastViewProps {
  workspace: WorkspacePayload;
  forecast: ForecastResult;
  onSaveSnapshot: (label: string) => Promise<void>;
  onJumpToResolve: () => void;
  busy: boolean;
}

export function ForecastView({
  workspace,
  forecast,
  onSaveSnapshot,
  onJumpToResolve,
  busy,
}: ForecastViewProps) {
  const [snapLabel, setSnapLabel] = useState('Baseline Snapshot');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(
    forecast.breach.firstBreachDayIndex,
  );

  const { breach, trustCounters, chasePriorities } = forecast;
  const activeDay =
    selectedDayIndex !== null && forecast.days[selectedDayIndex]
      ? forecast.days[selectedDayIndex]
      : forecast.days[0];

  return (
    <div>
      {/* Stage 1 & 2 KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Opening Cash (Day 0: {forecast.asOfDate})</div>
          <div className="kpi-value num">{formatINR(forecast.openingCashPaise)}</div>
          <div className="kpi-foot">Minimum Threshold: {formatINR(forecast.minimumCashPaise)}</div>
        </div>

        <div className={`kpi-card ${breach.firstBreachDate ? 'danger' : 'good'}`}>
          <div className="kpi-label">First Cash Gap / Breach</div>
          <div className="kpi-value num">
            {breach.firstBreachDate
              ? `Day ${breach.firstBreachDayIndex} (${formatINR(breach.firstBreachClosingPaise ?? '0')})`
              : 'No Breach'}
          </div>
          <div className="kpi-foot">
            {breach.firstBreachDate
              ? `${breach.firstBreachDate} • Shortfall ${formatINR(breach.shortfallPaise)}`
              : 'All forecasted days >= minimum cash'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Horizon Recovery & Nature</div>
          <div className="kpi-value num">
            {breach.isTimingGapOnly
              ? 'Timing Gap Only'
              : breach.firstBreachDate
                ? 'Structural Gap'
                : 'Healthy'}
          </div>
          <div className="kpi-foot">
            {breach.recoveryDate
              ? `Recovers on ${breach.recoveryDate}`
              : `Lowest: ${formatINR(breach.lowestBalancePaise)} (${breach.lowestBalanceDate})`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Financial Data Trust Score</div>
          <div className="kpi-value num">{trustCounters.trustRatioPct}% Verified/Confirmed</div>
          <div className="kpi-foot">
            Actuals: {trustCounters.actualCount} • Unconfirmed Expected: {trustCounters.unconfirmedExpectedCount} • Unmatched Tx: {trustCounters.unmatchedOrAmbiguousPayments}
          </div>
        </div>
      </div>

      {/* Stage 1: Daily Cash Curve */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Stage 1 — PREDICT: Daily End-of-Day Cash Forecast</h2>
            <div className="muted">
              Deterministic bigint-paise projection across {forecast.horizonDays} days from {forecast.asOfDate}.
            </div>
          </div>
          <div className="controls-row">
            <ClassificationBadge type="ACTUAL" />
            <ClassificationBadge type="EXPECTED" />
            {breach.firstBreachDate && (
              <button className="btn btn-primary" onClick={onJumpToResolve}>
                Resolve Day {breach.firstBreachDayIndex} Gap →
              </button>
            )}
          </div>
        </div>

        <CashCurveChart days={forecast.days} minimumCashPaise={forecast.minimumCashPaise} />
      </div>

      {/* Stage 2: Explain & Traceability */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Stage 2 — EXPLAIN: Breach Attribution</h3>
            {breach.firstBreachDate && <StatusPill status="AT_RISK" />}
          </div>
          <p style={{ marginTop: 0 }}>{breach.explanationSummary}</p>

          {breach.outflowDrivers.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6 }}>Outflows Driving First Breach</h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Counterparty</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breach.outflowDrivers.map((d) => (
                      <tr key={`${d.sourceType}-${d.sourceId}`}>
                        <td><span className="code-pill">{d.referenceCode}</span></td>
                        <td>{d.counterpartyName}</td>
                        <td className="num">{d.dueDate}</td>
                        <td className="num">-{formatINR(d.amountPaise)}</td>
                        <td><StatusPill status={d.evidenceStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {breach.delayedOrUnconfirmedInflows.length > 0 && (
            <>
              <h4 style={{ marginTop: 14, marginBottom: 6 }}>Later Receivables Arriving After Breach</h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Retailer</th>
                      <th>Expected</th>
                      <th>Amount</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breach.delayedOrUnconfirmedInflows.map((d) => (
                      <tr key={`${d.sourceType}-${d.sourceId}`}>
                        <td><span className="code-pill">{d.referenceCode}</span></td>
                        <td>{d.counterpartyName}</td>
                        <td className="num">{d.dueDate}</td>
                        <td className="num">+{formatINR(d.amountPaise)}</td>
                        <td><StatusPill status={d.evidenceStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Invoice Chase Priority</h3>
            <span className="badge badge-info">{chasePriorities.length} Open Receivables</span>
          </div>
          {chasePriorities.length === 0 ? (
            <p className="muted">No open receivables require chasing right now.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Retailer</th>
                    <th>Due</th>
                    <th>Outstanding</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {chasePriorities.map((c) => (
                    <tr key={c.invoiceId}>
                      <td><span className="code-pill">{c.invoiceNumber}</span></td>
                      <td>{c.retailerName}</td>
                      <td className="num">{c.dueDate}</td>
                      <td className="num">{formatINR(c.outstandingPaise)}</td>
                      <td>
                        <StatusPill status={c.evidenceStatus} />{' '}
                        <span className="muted">{c.rationale}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Day-by-Day Traceable Schedule + Selected Day Breakdown */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Dated Cash Schedule (Click Row to Inspect Records)</h3>
          </div>
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Date</th>
                  <th>Inflows</th>
                  <th>Outflows</th>
                  <th>Closing</th>
                </tr>
              </thead>
              <tbody>
                {forecast.days.map((d) => {
                  const hasActivity =
                    parsePaise(d.totalInflowsPaise) > 0n || parsePaise(d.totalOutflowsPaise) > 0n || d.dayIndex === 0;
                  if (!hasActivity && !d.belowMinimum) return null;
                  return (
                    <tr
                      key={d.date}
                      className={d.belowMinimum ? 'breach-row' : undefined}
                      style={{ cursor: 'pointer', outline: selectedDayIndex === d.dayIndex ? '2px solid var(--primary)' : 'none' }}
                      onClick={() => setSelectedDayIndex(d.dayIndex)}
                    >
                      <td className="num">Day {d.dayIndex}</td>
                      <td className="num">{d.date}</td>
                      <td className="num" style={{ color: 'var(--emerald)' }}>
                        {parsePaise(d.totalInflowsPaise) > 0n ? `+${formatINR(d.totalInflowsPaise)}` : '—'}
                      </td>
                      <td className="num" style={{ color: 'var(--rose)' }}>
                        {parsePaise(d.totalOutflowsPaise) > 0n ? `-${formatINR(d.totalOutflowsPaise)}` : '—'}
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: d.belowMinimum ? 'var(--rose)' : 'inherit' }}>
                        {formatINR(d.closingBalancePaise)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>
              Day {activeDay?.dayIndex ?? 0} Trace ({activeDay?.date})
            </h3>
            {activeDay && (
              <span className="num" style={{ fontWeight: 700 }}>
                Close: {formatINR(activeDay.closingBalancePaise)}
              </span>
            )}
          </div>
          {!activeDay || activeDay.items.length === 0 ? (
            <p className="muted">No scheduled cash movements on this date. Opening balance carries forward.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Ref</th>
                    <th>Counterparty</th>
                    <th>Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDay.items.map((it, idx) => (
                    <tr key={`${it.sourceId}-${idx}`}>
                      <td><ClassificationBadge type={it.classification} /></td>
                      <td><span className="code-pill">{it.referenceCode}</span></td>
                      <td>{it.counterpartyName}</td>
                      <td className="num" style={{ color: it.direction === 'INFLOW' ? 'var(--emerald)' : 'var(--rose)' }}>
                        {it.direction === 'INFLOW' ? '+' : '-'}{formatINR(it.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Scope B Lightweight Views: Cash Dependency Graph & Time-Machine Snapshots */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Cash Dependency Graph</h3>
            <span className="badge badge-neutral">Scope B View</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center', gap: '10px', fontSize: '0.84rem' }}>
            <div>
              <strong>Receivables (Inflows)</strong>
              {workspace.invoices.slice(0, 4).map((inv) => (
                <div key={inv.id} style={{ padding: '6px 8px', marginTop: 6, background: 'var(--emerald-soft)', borderRadius: 6, border: '1px solid #a7f3d0' }}>
                  <div><span className="code-pill">{inv.invoiceNumber}</span> {formatINR(inv.outstandingPaise)}</div>
                  <div className="muted">{inv.dueDate} • {inv.evidenceStatus}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '1.3rem', color: 'var(--muted)' }}>→</div>
            <div style={{ padding: '12px', background: 'var(--primary-soft)', borderRadius: 8, border: '1px solid #bfdbfe', textAlign: 'center' }}>
              <div style={{ fontWeight: 700 }}>Distributor Cash Pool</div>
              <div className="num" style={{ marginTop: 4 }}>Day 0: {formatINR(forecast.openingCashPaise)}</div>
              <div className="num" style={{ marginTop: 2, color: breach.firstBreachDate ? 'var(--rose)' : 'var(--emerald)', fontWeight: 700 }}>
                Lowest: {formatINR(breach.lowestBalancePaise)}
              </div>
            </div>
            <div style={{ fontSize: '1.3rem', color: 'var(--muted)' }}>→</div>
            <div>
              <strong>Payables & Expenses (Outflows)</strong>
              {workspace.bills.slice(0, 3).map((b) => (
                <div key={b.id} style={{ padding: '6px 8px', marginTop: 6, background: 'var(--rose-soft)', borderRadius: 6, border: '1px solid #fecdd3' }}>
                  <div><span className="code-pill">{b.billNumber}</span> {formatINR(b.outstandingPaise)}</div>
                  <div className="muted">{b.dueDate} • {b.priorityTier}</div>
                </div>
              ))}
              {workspace.expenses.slice(0, 2).map((e) => (
                <div key={e.id} style={{ padding: '6px 8px', marginTop: 6, background: 'var(--amber-soft)', borderRadius: 6, border: '1px solid #fde68a' }}>
                  <div><span className="code-pill">{e.expenseCode}</span> {formatINR(e.outstandingPaise)}</div>
                  <div className="muted">{e.dueDate} • {e.isProtected ? 'Protected' : 'Deferrable'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Time-Machine Forecast Snapshots</h3>
            <span className="badge badge-neutral">Saved History</span>
          </div>
          <div className="controls-row" style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={snapLabel}
              onChange={(e) => setSnapLabel(e.target.value)}
              placeholder="Snapshot label..."
              style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)' }}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !snapLabel.trim()}
              onClick={() => onSaveSnapshot(snapLabel.trim())}
            >
              Save Snapshot
            </button>
          </div>
          {workspace.snapshots.length === 0 ? (
            <p className="muted">No saved forecast snapshots yet.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>First Breach</th>
                    <th>Min Balance</th>
                    <th>Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.snapshots.map((s) => (
                    <tr key={s.id}>
                      <td>{s.snapshotLabel ?? s.dataClassification}</td>
                      <td className="num">{s.firstBreachDate ?? 'None'}</td>
                      <td className="num">{formatINR(s.minimumBalancePaise)}</td>
                      <td className="muted">{new Date(s.generatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

