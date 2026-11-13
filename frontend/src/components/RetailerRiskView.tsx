import { useEffect, useState } from 'react';
import { formatINR } from '@flowbridge/shared';
import { ShieldAlert, ShieldCheck, Clock, BrainCircuit, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { api } from '../api/client';

interface RetailerRiskViewProps {
  businessId: string;
}

export function RetailerRiskView({ businessId }: RetailerRiskViewProps) {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProfiles() {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getRetailerRiskProfiles(businessId);
      setProfiles(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
  }, [businessId]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="banner banner-error">
          <div><strong>Risk Radar Error:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Retailer Credit Risk & Reliability Radar</span>
              <span style={{ fontSize: '0.72rem', background: 'var(--primary-soft)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                Policy v2.0-Composite
              </span>
            </h2>
            <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
              Blends verified historical payment behavior (on-time rate, delay variance, commitment integrity) with XGBoost ML delay risk.
            </div>
          </div>
          <button className="btn btn-sm" onClick={loadProfiles} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Re-evaluate Risk Profiles
          </button>
        </div>

        {loading && profiles.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>Evaluating multi-factor retailer risk profiles...</p>
        ) : profiles.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>No retailers on file.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginTop: 16 }}>
            {profiles.map((p) => {
              const score = p.reliabilityScore;
              const stats = p.historicalStats ?? {};
              const model = p.modelPrediction ?? {};
              const hold = p.creditHoldDetails;

              const isInsufficient = p.riskCategory === 'INSUFFICIENT_DATA';

              const badgeColor =
                p.riskCategory === 'LOW_RISK'
                  ? { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' }
                  : p.riskCategory === 'MODERATE_RISK'
                    ? { bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE' }
                    : p.riskCategory === 'AT_RISK'
                      ? { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' }
                      : isInsufficient
                        ? { bg: '#F3F4F6', text: '#4B5563', border: '#E5E7EB' }
                        : { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' };

              const actionColor =
                p.recommendedCreditAction === 'NORMAL_CREDIT_TERMS'
                  ? '#16A34A'
                  : p.recommendedCreditAction === 'INCREASED_MONITORING'
                    ? '#2563EB'
                    : p.recommendedCreditAction === 'AUTHORISED_CREDIT_HOLD'
                      ? '#DC2626'
                      : '#D97706';

              return (
                <div
                  key={p.retailerId}
                  style={{
                    border: `1px solid ${hold?.isUnderCreditHold ? '#FECACA' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: 18,
                    background: hold?.isUnderCreditHold ? '#FFFBFB' : 'var(--surface)',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  {/* Retailer Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800 }}>{p.retailerName}</h4>
                      <span className="code-pill" style={{ fontSize: '0.72rem', marginTop: 2 }}>{p.retailerCode}</span>
                    </div>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: badgeColor.bg,
                        color: badgeColor.text,
                        border: `1px solid ${badgeColor.border}`,
                      }}
                    >
                      {p.riskCategory.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Credit Hold Notice (if applicable) */}
                  {hold?.isUnderCreditHold && (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#FEF2F2',
                        border: '1px solid #FCA5A5',
                        color: '#991B1B',
                        fontSize: '0.76rem',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                      }}
                    >
                      <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <strong>AUTHORISED CREDIT HOLD ACTIVE</strong>
                        <div style={{ marginTop: 2 }}>{hold.reason}</div>
                        <div style={{ marginTop: 4, fontStyle: 'italic', color: '#7F1D1D' }}>
                          ✓ {hold.restrictionScope}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reliability Score Bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                      <span className="muted">Reliability Score:</span>
                      <strong>
                        {isInsufficient ? 'N/A (Sparse)' : `${score}/100`}
                      </strong>
                    </div>
                    <div style={{ background: 'var(--border)', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${isInsufficient ? 20 : score}%`,
                          background: isInsufficient ? '#9CA3AF' : score >= 80 ? '#16A34A' : score >= 60 ? '#2563EB' : score >= 40 ? '#D97706' : '#DC2626',
                          height: '100%',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>

                  {/* Recommended Credit Action & Policy Rationale */}
                  <div style={{ background: 'var(--surface-alt)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                      Recommended Credit Action
                    </div>
                    <div style={{ fontWeight: 800, color: actionColor, fontSize: '0.86rem', marginTop: 2 }}>
                      {p.recommendedCreditAction?.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                      {p.suggestedAction}
                    </div>
                    {p.creditActionRationale && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text)', marginTop: 4, fontStyle: 'italic' }}>
                        Rationale: {p.creditActionRationale}
                      </div>
                    )}
                  </div>

                  {/* Historical Payment Statistics Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: '0.76rem' }}>
                    <div style={{ background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>
                      <div className="muted" style={{ fontSize: '0.68rem' }}>On-Time Rate</div>
                      <strong>{stats.onTimePaymentRate !== null ? `${(stats.onTimePaymentRate * 100).toFixed(0)}%` : 'No history'}</strong>
                    </div>
                    <div style={{ background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>
                      <div className="muted" style={{ fontSize: '0.68rem' }}>Avg Delay</div>
                      <strong>{stats.averageDelayDays !== null ? `${stats.averageDelayDays.toFixed(1)}d` : 'N/A'}</strong>
                    </div>
                    <div style={{ background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>
                      <div className="muted" style={{ fontSize: '0.68rem' }}>Delay Variance</div>
                      <strong>{stats.delayVariabilityDays !== null ? `±${stats.delayVariabilityDays.toFixed(1)}d` : 'N/A'}</strong>
                    </div>
                    <div style={{ background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>
                      <div className="muted" style={{ fontSize: '0.68rem' }}>Outstanding</div>
                      <strong>{formatINR(p.totalOutstandingPaise)}</strong>
                    </div>
                    <div style={{ background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>
                      <div className="muted" style={{ fontSize: '0.68rem' }}>Limit Utilisation</div>
                      <strong>{stats.creditLimitUtilisationPct !== null ? `${stats.creditLimitUtilisationPct.toFixed(0)}%` : 'No limit'}</strong>
                    </div>
                    <div style={{ background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>
                      <div className="muted" style={{ fontSize: '0.68rem' }}>Recent Trend</div>
                      <strong style={{ color: stats.recentPaymentTrend === 'IMPROVING' ? '#16A34A' : stats.recentPaymentTrend === 'DETERIORATING' ? '#DC2626' : 'inherit' }}>
                        {stats.recentPaymentTrend?.replace('_', ' ') ?? 'STABLE'}
                      </strong>
                    </div>
                  </div>

                  {/* ML Model Prediction Status */}
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: model.status === 'EVALUATED' ? '#F5F3FF' : 'var(--surface-alt)',
                      border: `1px solid ${model.status === 'EVALUATED' ? '#DDD6FE' : 'var(--border)'}`,
                      fontSize: '0.74rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <BrainCircuit size={14} color="#7C3AED" />
                      <span>XGBoost ML Status:</span>
                    </div>
                    <span
                      style={{
                        fontWeight: 700,
                        color: model.status === 'EVALUATED' ? '#6D28D9' : 'var(--text-muted)',
                      }}
                    >
                      {model.status === 'EVALUATED' ? `Delay +${model.predictedDelayDays}d` : model.status === 'MODEL_NOT_DEPLOYED' ? 'Model Pending' : 'Offline'}
                    </span>
                  </div>

                  {/* Positive & Negative Factors */}
                  <div style={{ fontSize: '0.76rem' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Scoring Drivers:</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {p.reasons.map((r: string, idx: number) => (
                        <li key={idx} className="muted" style={{ marginBottom: 2 }}>{r}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                    Last Evaluated: {p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : 'Just now'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
