import { useEffect, useState } from 'react';
import { formatINR } from '@flowbridge/shared';
import { api } from '../api/client';
import { StatusPill } from './Badge';

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
    <div>
      {error && (
        <div className="banner banner-error">
          <div><strong>Risk Radar Error:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h2>Retailer Credit Risk & Reliability Radar</h2>
            <div className="muted">
              Objective credit risk evaluation based on settlement speed, promise fulfillment, and credit limit compliance.
            </div>
          </div>
          <button className="btn" onClick={loadProfiles}>
            ↻ Re-evaluate Risk
          </button>
        </div>

        {loading && profiles.length === 0 ? (
          <p className="muted">Evaluating retailer risk factors...</p>
        ) : profiles.length === 0 ? (
          <p className="muted">No retailers on file.</p>
        ) : (
          <div className="grid-2">
            {profiles.map((p) => {
              const score = p.reliabilityScore;
              const badgeClass =
                p.riskCategory === 'LOW_RISK'
                  ? 'badge-actual'
                  : p.riskCategory === 'MODERATE_RISK'
                    ? 'badge-info'
                    : p.riskCategory === 'AT_RISK'
                      ? 'badge-scenario'
                      : 'badge-error';

              return (
                <div
                  key={p.retailerId}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 16,
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <h4 style={{ margin: 0 }}>{p.retailerName}</h4>
                      <span className="code-pill">{p.retailerCode}</span>
                    </div>
                    <span className={`badge ${badgeClass}`}>{p.riskCategory.replace('_', ' ')}</span>
                  </div>

                  <div style={{ margin: '12px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
                      <span className="muted">Reliability Score:</span>
                      <strong>{score}/100</strong>
                    </div>
                    <div style={{ background: 'var(--border)', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${score}%`,
                          background: score >= 80 ? 'var(--emerald)' : score >= 50 ? 'var(--amber)' : 'var(--danger)',
                          height: '100%',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ fontSize: '0.85rem', marginBottom: 10 }}>
                    <div><strong>Total Outstanding:</strong> {formatINR(p.totalOutstandingPaise)}</div>
                    <div><strong>Approved Credit Limit:</strong> {formatINR(p.creditLimitPaise)}</div>
                    <div><strong>Past-Due Invoices:</strong> {p.overdueInvoicesCount}</div>
                    <div><strong>Broken Commitments:</strong> {p.brokenCommitmentsCount}</div>
                  </div>

                  <div style={{ background: 'var(--surface-alt)', padding: 10, borderRadius: 6, fontSize: '0.82rem' }}>
                    <strong style={{ display: 'block', marginBottom: 4 }}>Key Factors:</strong>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {p.reasons.map((r: string, idx: number) => (
                        <li key={idx} className="muted">{r}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--primary)' }}>
                    <strong>Recommended Action:</strong> {p.suggestedAction}
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

