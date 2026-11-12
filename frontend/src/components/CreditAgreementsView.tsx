import { useEffect, useState } from 'react';
import { formatINR, paiseToString, rupeesToPaise } from '@flowbridge/shared';
import { api, type WorkspacePayload } from '../api/client';
import { StatusPill } from './Badge';

interface CreditAgreementsViewProps {
  workspace: WorkspacePayload;
  businessId: string;
}

export function CreditAgreementsView({ workspace, businessId }: CreditAgreementsViewProps) {
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Agreement Form State
  const [retailerId, setRetailerId] = useState(workspace.retailers[0]?.id ?? '');
  const [limitInr, setLimitInr] = useState('100000');
  const [termDays, setTermDays] = useState(30);
  const [graceDays, setGraceDays] = useState(7);
  const [lateFeePct, setLateFeePct] = useState(0);
  const [notes, setNotes] = useState('Standard bilateral credit agreement terms');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [busy, setBusy] = useState(false);

  // Credit Sale Check Simulation
  const [checkRetailerId, setCheckRetailerId] = useState(workspace.retailers[0]?.id ?? '');
  const [checkSaleInr, setCheckSaleInr] = useState('35000');
  const [checkResult, setCheckResult] = useState<any | null>(null);

  async function loadAgreements() {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listCreditAgreements(businessId);
      setAgreements(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgreements();
  }, [businessId]);

  async function handleCreateAgreement() {
    if (!retailerId || !limitInr) return;
    setBusy(true);
    setError(null);
    try {
      const creditLimitPaise = paiseToString(rupeesToPaise(limitInr));
      await api.createCreditAgreement(businessId, {
        retailerId,
        creditLimitPaise,
        standardTermDays: termDays,
        gracePeriodDays: graceDays,
        lateFeePct,
        notes,
      });
      setShowCreateModal(false);
      await loadAgreements();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckCreditSale() {
    if (!checkRetailerId || !checkSaleInr) return;
    setBusy(true);
    try {
      const salePaise = paiseToString(rupeesToPaise(checkSaleInr));
      const result = await api.checkCreditSale(businessId, checkRetailerId, salePaise);
      setCheckResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="banner banner-error">
          <div><strong>Credit Agreement Alert:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Credit Sale Protection Simulator */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Credit-Sale Pre-Authorization Gate</h2>
            <div className="muted">
              Verifies credit limits, overdue invoices, and active agreements before confirming new credit sales.
            </div>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Select Retailer</label>
            <select value={checkRetailerId} onChange={(e) => setCheckRetailerId(e.target.value)}>
              {workspace.retailers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.retailerCode})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Proposed Credit Order (₹)</label>
            <input value={checkSaleInr} onChange={(e) => setCheckSaleInr(e.target.value)} />
          </div>
        </div>
        <div className="controls-row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={busy} onClick={handleCheckCreditSale}>
            Verify Credit Eligibility
          </button>
        </div>

        {checkResult && (
          <div
            className={`banner ${checkResult.allowed ? 'banner-success' : 'banner-error'}`}
            style={{ marginTop: 14 }}
          >
            <div>
              <strong>{checkResult.allowed ? 'SALE PERMITTED' : 'SALE BLOCKED'}:</strong>{' '}
              {checkResult.reason}
              <div className="muted" style={{ marginTop: 4 }}>
                Active Agreement: {checkResult.activeAgreementNumber ?? 'None'} • Credit Limit:{' '}
                {formatINR(checkResult.creditLimitPaise)} • Current Outstanding:{' '}
                {formatINR(checkResult.currentOutstandingPaise)} • Proposed Exposure:{' '}
                {formatINR(checkResult.proposedExposurePaise)}
              </div>
            </div>
            <StatusPill status={checkResult.allowed ? 'AGREED' : 'FAILED'} />
          </div>
        )}
      </div>

      {/* Agreements List */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Active Retailer Credit Agreements</h3>
            <div className="muted">
              Legally grounded payment terms, credit limits, and dispute governance per retailer.
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create New Agreement
          </button>
        </div>

        {showCreateModal && (
          <div style={{ padding: 14, background: 'var(--surface-alt)', borderRadius: 8, marginBottom: 16 }}>
            <h4>Draft Retailer Credit Agreement</h4>
            <div className="form-grid">
              <div className="field">
                <label>Retailer</label>
                <select value={retailerId} onChange={(e) => setRetailerId(e.target.value)}>
                  {workspace.retailers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.retailerCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Credit Limit (₹)</label>
                <input value={limitInr} onChange={(e) => setLimitInr(e.target.value)} />
              </div>
              <div className="field">
                <label>Standard Terms (Days)</label>
                <input
                  type="number"
                  value={termDays}
                  onChange={(e) => setTermDays(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Grace Period (Days)</label>
                <input
                  type="number"
                  value={graceDays}
                  onChange={(e) => setGraceDays(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Late Fee (% per month)</label>
                <input
                  type="number"
                  step="0.5"
                  value={lateFeePct}
                  onChange={(e) => setLateFeePct(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Notes & Conditions</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="controls-row" style={{ marginTop: 12 }}>
              <button className="btn btn-emerald" disabled={busy} onClick={handleCreateAgreement}>
                Save & Issue Agreement
              </button>
              <button className="btn" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && agreements.length === 0 ? (
          <p className="muted">Loading agreements...</p>
        ) : agreements.length === 0 ? (
          <div className="banner banner-info">
            <div>No credit agreements recorded yet. Create an agreement to enable structured credit tracking.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agreement Ref</th>
                  <th>Retailer</th>
                  <th>Credit Limit</th>
                  <th>Standard Terms</th>
                  <th>Grace Period</th>
                  <th>Status</th>
                  <th>Effective Date</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((agr) => (
                  <tr key={agr.id}>
                    <td>
                      <strong><span className="code-pill">{agr.agreementNumber}</span></strong>
                    </td>
                    <td>
                      <strong>{agr.retailerName}</strong>
                      <div className="muted">{agr.retailerCode}</div>
                    </td>
                    <td className="num"><strong>{formatINR(agr.creditLimitPaise)}</strong></td>
                    <td className="num">{agr.standardTermDays} Days</td>
                    <td className="num">{agr.gracePeriodDays} Days</td>
                    <td><StatusPill status={agr.status} /></td>
                    <td className="num">{agr.validFrom}</td>
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

