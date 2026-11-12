import { useEffect, useState } from 'react';
import { formatINR, paiseToDecimalInput, paiseToString, rupeesToPaise } from '@flowbridge/shared';
import { api } from '../api/client';
import { StatusPill } from './Badge';

interface EmergencyReserveViewProps {
  businessId: string;
}

export function EmergencyReserveView({ businessId }: EmergencyReserveViewProps) {
  const [data, setData] = useState<{ reserve: any; recentMovements: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositAmountInr, setDepositAmountInr] = useState('');
  const [depositReason, setDepositReason] = useState('Operating Cash Surplus Sweep');
  const [withdrawAmountInr, setWithdrawAmountInr] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [targetReserveInr, setTargetReserveInr] = useState('');
  const [minThresholdInr, setMinThresholdInr] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReserveStatus(businessId);
      setData(res);
      setTargetReserveInr(paiseToDecimalInput(res.reserve.targetReservePaise));
      setMinThresholdInr(paiseToDecimalInput(res.reserve.minimumThresholdPaise));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [businessId]);

  async function handleDeposit() {
    if (!depositAmountInr) return;
    setActionBusy(true);
    setError(null);
    try {
      const paise = paiseToString(rupeesToPaise(depositAmountInr));
      await api.depositToReserve(businessId, paise, depositReason);
      setDepositAmountInr('');
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!withdrawAmountInr || !withdrawReason) {
      setError('Withdrawal amount and specific emergency justification are required.');
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      const paise = paiseToString(rupeesToPaise(withdrawAmountInr));
      await api.withdrawFromReserve(businessId, paise, withdrawReason);
      setWithdrawAmountInr('');
      setWithdrawReason('');
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSaveSettings() {
    setActionBusy(true);
    setError(null);
    try {
      const targetPaise = paiseToString(rupeesToPaise(targetReserveInr));
      const minPaise = paiseToString(rupeesToPaise(minThresholdInr));
      await api.updateReserveSettings(businessId, targetPaise, minPaise);
      setShowSettings(false);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  if (loading && !data) {
    return <div className="card"><p className="muted">Loading Emergency Reserve Management...</p></div>;
  }

  const reserve = data?.reserve;
  const targetPaise = BigInt(reserve?.targetReservePaise ?? '0');
  const currentPaise = BigInt(reserve?.currentReservePaise ?? '0');
  const pct = targetPaise > 0n ? Math.min(100, Number((currentPaise * 100n) / targetPaise)) : 0;

  return (
    <div>
      {error && (
        <div className="banner banner-error">
          <div><strong>Reserve Alert:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* KPI Overview */}
      <div className="kpi-grid">
        <div className="kpi-card good">
          <div className="kpi-label">Current Emergency Reserve</div>
          <div className="kpi-value num">{formatINR(reserve?.currentReservePaise ?? '0')}</div>
          <div className="kpi-foot">Protected buffer for unavoidable shortages</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Configured Target</div>
          <div className="kpi-value num">{formatINR(reserve?.targetReservePaise ?? '0')}</div>
          <div className="kpi-foot">{pct}% of funding target reached</div>
        </div>
        <div className={`kpi-card ${BigInt(reserve?.deficitPaise ?? '0') > 0n ? 'danger' : ''}`}>
          <div className="kpi-label">Replenishment Deficit</div>
          <div className="kpi-value num">{formatINR(reserve?.deficitPaise ?? '0')}</div>
          <div className="kpi-foot">Required from surplus receipts</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Status & Protection</div>
          <div style={{ marginTop: 8 }}><StatusPill status={reserve?.status ?? 'ACTIVE'} /></div>
          <div className="kpi-foot">Minimum Floor: {formatINR(reserve?.minimumThresholdPaise ?? '0')}</div>
        </div>
      </div>

      {/* Reserve Buffer Progress Bar */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Emergency Reserve Protection Gauge</h3>
            <div className="muted">Internal cash ring-fenced from standard day-to-day operations.</div>
          </div>
          <button className="btn" onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? 'Close Settings' : 'Configure Target & Floor'}
          </button>
        </div>

        <div style={{ margin: '14px 0', background: 'var(--border)', height: 20, borderRadius: 10, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              background: pct >= 80 ? 'var(--emerald)' : pct >= 40 ? 'var(--amber)' : 'var(--danger)',
              height: '100%',
              transition: 'width 0.4s ease',
            }}
          />
        </div>

        {showSettings && (
          <div style={{ padding: 14, background: 'var(--surface-alt)', borderRadius: 8, marginTop: 14 }}>
            <h4>Adjust Reserve Thresholds</h4>
            <div className="form-grid">
              <div className="field">
                <label>Target Reserve (₹)</label>
                <input value={targetReserveInr} onChange={(e) => setTargetReserveInr(e.target.value)} />
              </div>
              <div className="field">
                <label>Minimum Protected Floor (₹)</label>
                <input value={minThresholdInr} onChange={(e) => setMinThresholdInr(e.target.value)} />
              </div>
            </div>
            <div className="controls-row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={actionBusy} onClick={handleSaveSettings}>
                Save Settings
              </button>
              <button className="btn" onClick={() => setShowSettings(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Movement Controls: Deposit & Emergency Withdrawal */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Sweep Surplus into Reserve</h3>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Transfer excess operating cash into the emergency reserve ring-fence.
          </p>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Deposit Amount (₹)</label>
            <input
              value={depositAmountInr}
              onChange={(e) => setDepositAmountInr(e.target.value)}
              placeholder="e.g. 25000"
            />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Reason / Source</label>
            <input
              value={depositReason}
              onChange={(e) => setDepositReason(e.target.value)}
              placeholder="e.g. Day 10 Customer Collection Surplus"
            />
          </div>
          <button className="btn btn-emerald" disabled={actionBusy || !depositAmountInr} onClick={handleDeposit}>
            Deposit into Reserve
          </button>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Emergency Reserve Draw</h3>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Release reserve cash into operating cash to bridge an imminent breach when other levers fail.
          </p>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Withdrawal Amount (₹)</label>
            <input
              value={withdrawAmountInr}
              onChange={(e) => setWithdrawAmountInr(e.target.value)}
              placeholder="e.g. 15000"
            />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Emergency Justification (Required)</label>
            <input
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="e.g. Essential supplier payment S-2041 timing gap"
            />
          </div>
          <button className="btn btn-danger" disabled={actionBusy || !withdrawAmountInr || !withdrawReason} onClick={handleWithdraw}>
            Execute Emergency Release
          </button>
        </div>
      </div>

      {/* Auditable Reserve History */}
      <div className="card">
        <div className="card-header">
          <h3>Auditable Reserve Movements</h3>
        </div>
        {data?.recentMovements.length === 0 ? (
          <p className="muted">No reserve movements recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Amount</th>
                  <th>Authorized By</th>
                  <th>Reason & Audit Note</th>
                </tr>
              </thead>
              <tbody>
                {data?.recentMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{new Date(m.createdAt).toLocaleString()}</td>
                    <td>
                      <StatusPill status={m.movementType === 'DEPOSIT' ? 'AGREED' : 'FAILED'} />
                    </td>
                    <td className="num">
                      <strong>
                        {m.movementType === 'DEPOSIT' ? '+' : '-'}
                        {formatINR(m.amountPaise)}
                      </strong>
                    </td>
                    <td>{m.authorizedBy}</td>
                    <td>{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

