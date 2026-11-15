import React, { useState } from 'react';
import { Shield, Settings, DollarSign, Clock, CheckCircle2 } from 'lucide-react';
import { formatINR, parsePaise, type BusinessDTO, type ApprovalLimits } from '@flowbridge/shared';

interface BusinessSettingsViewProps {
  business: BusinessDTO;
  busy: boolean;
  onUpdateSettings: (patch: any) => Promise<void>;
}

export const BusinessSettingsView: React.FC<BusinessSettingsViewProps> = ({
  business,
  busy,
  onUpdateSettings,
}) => {
  const [openingCashRupees, setOpeningCashRupees] = useState<number>(
    Number(parsePaise(business.openingCashPaise || '0')) / 100,
  );
  const [minCashRupees, setMinCashRupees] = useState<number>(
    Number(parsePaise(business.minimumCashPaise || '0')) / 100,
  );
  const [openingCashDate, setOpeningCashDate] = useState<string>(business.openingCashDate || '');
  const [allocationPolicy, setAllocationPolicy] = useState<string>(
    business.allocationPolicy || 'OLDEST_DUE_FIRST',
  );
  const [limits, setLimits] = useState<ApprovalLimits>(business.approvalLimits);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSettings({
      openingCashPaise: (BigInt(Math.round(openingCashRupees)) * 100n).toString(),
      openingCashDate,
      minimumCashPaise: (BigInt(Math.round(minCashRupees)) * 100n).toString(),
      allocationPolicy,
      approvalLimits: limits,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 4000);
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {savedNotice && (
        <div className="banner banner-success">
          <CheckCircle2 size={18} color="var(--green)" />
          <div>Business cash setup and liquidity policy successfully updated!</div>
        </div>
      )}

      {/* ── CARD 1: OPERATING CASH SETUP ── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DollarSign size={18} color="var(--primary)" />
              <h3 style={{ margin: 0 }}>Operating Cash Setup</h3>
            </div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 3 }}>
              Configure opening bank balances and baseline safety thresholds for the deterministic forecasting engine.
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>Opening Verified Cash (₹)</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={openingCashRupees}
                onChange={(e) => setOpeningCashRupees(Number(e.target.value))}
                required
              />
              <span className="muted" style={{ fontSize: '0.74rem' }}>
                Current: {formatINR(business.openingCashPaise)}
              </span>
            </div>

            <div className="field">
              <label>Opening Cash Benchmark Date (Day 0)</label>
              <input
                type="date"
                value={openingCashDate}
                onChange={(e) => setOpeningCashDate(e.target.value)}
                required
              />
              <span className="muted" style={{ fontSize: '0.74rem' }}>
                All 15d and 30d forecast schedules project forward from this date.
              </span>
            </div>

            <div className="field">
              <label>Minimum Operating Cash Floor (₹)</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={minCashRupees}
                onChange={(e) => setMinCashRupees(Number(e.target.value))}
                required
              />
              <span className="muted" style={{ fontSize: '0.74rem' }}>
                Forecast alerts fire whenever closing cash dips below this amount.
              </span>
            </div>

            <div className="field">
              <label>Default Payment Allocation Policy</label>
              <select
                value={allocationPolicy}
                onChange={(e) => setAllocationPolicy(e.target.value)}
              >
                <option value="OLDEST_DUE_FIRST">Oldest Due First (FIFO)</option>
                <option value="EXPLICIT_THEN_OLDEST_DUE_FIRST">
                  Explicit Reference Then Oldest Due
                </option>
              </select>
              <span className="muted" style={{ fontSize: '0.74rem' }}>
                Governs automatic matching of unreferenced bank credits.
              </span>
            </div>
          </div>

          {/* ── DISTRIBUTOR LIQUIDITY BOUNDS ── */}
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Shield size={18} color="var(--primary)" />
              <h4 style={{ margin: 0, fontSize: '0.96rem' }}>
                Distributor-Approved Resolution Policy Bounds
              </h4>
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
                <label>Max Early Collection Days Window</label>
                <input
                  type="number"
                  min={1}
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
                <label>Max Supplier Deferral Window (Days)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={limits.defaultMaxSupplierDeferralDays}
                  onChange={(e) =>
                    setLimits({ ...limits, defaultMaxSupplierDeferralDays: Number(e.target.value) })
                  }
                />
              </div>

              <div className="field">
                <label>Protect Essential Operating Expenses</label>
                <select
                  value={limits.protectEssentialExpenses ? 'true' : 'false'}
                  onChange={(e) =>
                    setLimits({ ...limits, protectEssentialExpenses: e.target.value === 'true' })
                  }
                >
                  <option value="true">Yes — Liquidity Firewall Active (Protected)</option>
                  <option value="false">No — Allow Deferral Under Review</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save Business Cash & Liquidity Settings
            </button>
          </div>
        </form>
      </div>

      {/* ── CARD 2: ACCOUNT & BUSINESS PROFILE ── */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={18} color="var(--primary)" />
            <h3 style={{ margin: 0 }}>Business Profile Information</h3>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div style={{ padding: 14, borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Distributor Business Name
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>
              {business.name}
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Business Code
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
              <span className="code-pill">{business.code}</span>
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Minimum Cash Threshold
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>
              {formatINR(business.minimumCashPaise || '5000000')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
