import { useEffect, useState } from 'react';
import { formatINR, paiseToString, rupeesToPaise } from '@flowbridge/shared';
import { api, type WorkspacePayload } from '../api/client';
import { StatusPill } from './Badge';

interface NegotiationsViewProps {
  workspace: WorkspacePayload;
  businessId: string;
  onRefreshWorkspace: () => Promise<void>;
}

export function NegotiationsView({ workspace, businessId, onRefreshWorkspace }: NegotiationsViewProps) {
  const [negotiations, setNegotiations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Proposal Form
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [invoiceId, setInvoiceId] = useState(workspace.invoices[0]?.id ?? '');
  const [proposedAmountInr, setProposedAmountInr] = useState('20000');
  const [proposedDueDate, setProposedDueDate] = useState('');
  const [initialMessage, setInitialMessage] = useState('Customer requested split UPI arrangement');
  const [channel, setChannel] = useState('WHATSAPP');
  const [busy, setBusy] = useState(false);

  // Counteroffer Form
  const [counterId, setCounterId] = useState<string | null>(null);
  const [counterAmountInr, setCounterAmountInr] = useState('');
  const [counterDueDate, setCounterDueDate] = useState('');
  const [counterMessage, setCounterMessage] = useState('');

  async function loadNegotiations() {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listNegotiations(businessId);
      setNegotiations(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNegotiations();
  }, [businessId]);

  async function handleCreateProposal() {
    const inv = workspace.invoices.find((i) => i.id === invoiceId);
    if (!inv || !proposedAmountInr || !proposedDueDate) {
      setError('Please select an invoice, proposed amount, and revised date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const propPaise = paiseToString(rupeesToPaise(proposedAmountInr));
      await api.proposeNegotiation(businessId, {
        customerInvoiceId: inv.id,
        counterpartyType: 'RETAILER',
        counterpartyId: inv.retailerId,
        counterpartyName: inv.retailerName ?? inv.retailerCode ?? 'Retailer',
        originalAmountPaise: inv.outstandingPaise,
        originalDueDate: inv.dueDate,
        proposedAmountPaise: propPaise,
        proposedDueDate,
        channel,
        initialMessage,
      });
      setShowProposeModal(false);
      await loadNegotiations();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCounterOffer(negId: string) {
    if (!counterAmountInr || !counterDueDate) {
      setError('Counteroffer amount and date are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const counterPaise = paiseToString(rupeesToPaise(counterAmountInr));
      await api.counterOfferNegotiation(businessId, negId, counterPaise, counterDueDate, counterMessage);
      setCounterId(null);
      await loadNegotiations();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(negId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.acceptNegotiation(businessId, negId);
      await loadNegotiations();
      await onRefreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(negId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.rejectNegotiation(businessId, negId, 'Declined by distributor desk');
      await loadNegotiations();
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
          <div><strong>Negotiation Alert:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h2>Payment Negotiation Centre</h2>
            <div className="muted">
              Structured counter-proposals, installment scheduling, and bilateral debt restructuring.
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowProposeModal(true)}>
            + Propose Revised Arrangement
          </button>
        </div>

        {showProposeModal && (
          <div style={{ padding: 14, background: 'var(--surface-alt)', borderRadius: 8, marginBottom: 16 }}>
            <h4>Initiate Payment Negotiation Proposal</h4>
            <div className="form-grid">
              <div className="field">
                <label>Target Customer Invoice</label>
                <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                  {workspace.invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} — {inv.retailerName} ({formatINR(inv.outstandingPaise)}, due {inv.dueDate})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Proposed Revised Amount (₹)</label>
                <input value={proposedAmountInr} onChange={(e) => setProposedAmountInr(e.target.value)} />
              </div>
              <div className="field">
                <label>Proposed Revised Date</label>
                <input type="date" value={proposedDueDate} onChange={(e) => setProposedDueDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Channel</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="PHONE">Phone Call</option>
                  <option value="EMAIL">Email</option>
                  <option value="IN_PERSON">In Person</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label>Counterparty Stated Reason</label>
                <input value={initialMessage} onChange={(e) => setInitialMessage(e.target.value)} />
              </div>
            </div>
            <div className="controls-row" style={{ marginTop: 12 }}>
              <button className="btn btn-emerald" disabled={busy} onClick={handleCreateProposal}>
                Submit Proposal
              </button>
              <button className="btn" onClick={() => setShowProposeModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && negotiations.length === 0 ? (
          <p className="muted">Loading negotiations...</p>
        ) : negotiations.length === 0 ? (
          <div className="banner banner-info">
            <div>
              No active payment negotiations on record. Retailer extension requests and restructuring plans appear here.
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Counterparty</th>
                  <th>Original Terms</th>
                  <th>Proposed Revised Terms</th>
                  <th>Counter-Offer Terms</th>
                  <th>Status</th>
                  <th>Channel</th>
                  <th>Actions & Decision</th>
                </tr>
              </thead>
              <tbody>
                {negotiations.map((neg) => (
                  <tr key={neg.id}>
                    <td>
                      <strong>{neg.counterpartyName}</strong>
                      <div className="muted">{neg.counterpartyType}</div>
                    </td>
                    <td className="num">
                      {formatINR(neg.originalAmountPaise)}
                      <div className="muted">{neg.originalDueDate}</div>
                    </td>
                    <td className="num">
                      <strong style={{ color: 'var(--amber)' }}>{formatINR(neg.proposedAmountPaise)}</strong>
                      <div className="muted">{neg.proposedDueDate}</div>
                    </td>
                    <td className="num">
                      {neg.counterOfferAmountPaise ? (
                        <>
                          <strong style={{ color: 'var(--primary)' }}>
                            {formatINR(neg.counterOfferAmountPaise)}
                          </strong>
                          <div className="muted">{neg.counterOfferDueDate}</div>
                        </>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td><StatusPill status={neg.status} /></td>
                    <td><span className="code-pill">{neg.channel}</span></td>
                    <td>
                      {neg.status === 'PROPOSED' || neg.status === 'COUNTER_OFFERED' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-emerald btn-sm"
                            disabled={busy}
                            onClick={() => handleAccept(neg.id)}
                            title="Accept and sync into forecast commitment"
                          >
                            Accept
                          </button>
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => {
                              setCounterId(neg.id);
                              setCounterAmountInr(
                                (Number(neg.proposedAmountPaise) / 100).toString(),
                              );
                              setCounterDueDate(neg.proposedDueDate);
                            }}
                          >
                            Counter
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => handleReject(neg.id)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          Finalized ({neg.status})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Counter Offer Sub-Modal */}
        {counterId && (
          <div style={{ padding: 14, background: 'var(--primary-soft)', border: '1px solid var(--primary)', borderRadius: 8, marginTop: 14 }}>
            <h4>Distributor Counter-Offer</h4>
            <div className="form-grid">
              <div className="field">
                <label>Counter Amount (₹)</label>
                <input value={counterAmountInr} onChange={(e) => setCounterAmountInr(e.target.value)} />
              </div>
              <div className="field">
                <label>Counter Date</label>
                <input type="date" value={counterDueDate} onChange={(e) => setCounterDueDate(e.target.value)} />
              </div>
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label>Distributor Notes / Counter Message</label>
                <input
                  value={counterMessage}
                  onChange={(e) => setCounterMessage(e.target.value)}
                  placeholder="e.g. Can accept ₹30k by Friday, remaining ₹20k next week"
                />
              </div>
            </div>
            <div className="controls-row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => handleCounterOffer(counterId)}>
                Send Counter-Offer
              </button>
              <button className="btn" onClick={() => setCounterId(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

