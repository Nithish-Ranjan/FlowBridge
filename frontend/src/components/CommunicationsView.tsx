import { useEffect, useState } from 'react';
import { formatINR } from '@flowbridge/shared';
import { api, type WorkspacePayload } from '../api/client';
import { StatusPill } from './Badge';

interface CommunicationsViewProps {
  workspace: WorkspacePayload;
  businessId: string;
}

export function CommunicationsView({ workspace, businessId }: CommunicationsViewProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Dispatch Controls
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(workspace.invoices[0]?.id ?? '');
  const [selectedPaymentId, setSelectedPaymentId] = useState(workspace.transactions[0]?.id ?? '');
  const [dispatchChannel, setDispatchChannel] = useState<'EMAIL' | 'WHATSAPP'>('WHATSAPP');
  const [busy, setBusy] = useState(false);

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getCommunicationLogs(businessId);
      setLogs(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, [businessId]);

  async function handleSendInvoice() {
    if (!selectedInvoiceId) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (dispatchChannel === 'EMAIL') {
        await api.sendInvoiceEmail(businessId, selectedInvoiceId);
      } else {
        await api.sendInvoiceWhatsApp(businessId, selectedInvoiceId);
      }
      setSuccessMsg(`Invoice dispatched successfully via ${dispatchChannel}!`);
      await loadLogs();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendReceipt() {
    if (!selectedPaymentId) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.sendPaymentReceipt(businessId, selectedPaymentId, dispatchChannel);
      setSuccessMsg(`Official payment receipt dispatched via ${dispatchChannel}!`);
      await loadLogs();
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
          <div><strong>Communication Error:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {successMsg && (
        <div className="banner banner-success">
          <div>{successMsg}</div>
          <button className="btn btn-sm" onClick={() => setSuccessMsg(null)}>✕</button>
        </div>
      )}

      {/* Dispatch Console */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Send Invoice Notification</h3>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Dispatch formal PDF invoice notifications directly to retailers via Email or WhatsApp Business.
          </p>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Select Invoice</label>
            <select value={selectedInvoiceId} onChange={(e) => setSelectedInvoiceId(e.target.value)}>
              {workspace.invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — {inv.retailerName} ({formatINR(inv.outstandingPaise)})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Channel</label>
            <select value={dispatchChannel} onChange={(e) => setDispatchChannel(e.target.value as typeof dispatchChannel)}>
              <option value="WHATSAPP">Official WhatsApp Business</option>
              <option value="EMAIL">Verified Email Delivery</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={busy || !selectedInvoiceId} onClick={handleSendInvoice}>
            Send Invoice Notification
          </button>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Send Payment Receipt</h3>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Acknowledge verified payment receipts instantly with reference numbers and updated balance.
          </p>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Select Verified Transaction</label>
            <select value={selectedPaymentId} onChange={(e) => setSelectedPaymentId(e.target.value)}>
              {workspace.transactions.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {tx.valueDate} — {tx.matchedRetailerName ?? 'Retailer'} ({formatINR(tx.amountPaise)})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Channel</label>
            <select value={dispatchChannel} onChange={(e) => setDispatchChannel(e.target.value as typeof dispatchChannel)}>
              <option value="WHATSAPP">Official WhatsApp Business</option>
              <option value="EMAIL">Verified Email Delivery</option>
            </select>
          </div>
          <button className="btn btn-emerald" disabled={busy || !selectedPaymentId} onClick={handleSendReceipt}>
            Send Payment Receipt
          </button>
        </div>
      </div>

      {/* Communications Audit Trail */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Outbound Delivery Logs</h3>
            <div className="muted">Tracked delivery records with external gateway message IDs and receipt states.</div>
          </div>
          <button className="btn" onClick={loadLogs}>↻ Refresh Logs</button>
        </div>

        {loading && logs.length === 0 ? (
          <p className="muted">Loading communication logs...</p>
        ) : logs.length === 0 ? (
          <p className="muted">No messages sent yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Template / Subject</th>
                  <th>Delivery Status</th>
                  <th>Gateway Tracking Ref</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="muted">{new Date(log.createdAt).toLocaleString()}</td>
                    <td>
                      <strong>{log.recipientName}</strong>
                      <div className="muted">{log.recipientAddress}</div>
                    </td>
                    <td><span className="code-pill">{log.channel}</span></td>
                    <td>
                      <strong>{log.templateKey ?? 'Custom'}</strong>
                      {log.subject && <div className="muted">{log.subject}</div>}
                    </td>
                    <td>
                      <StatusPill status={log.status === 'DELIVERED' ? 'VERIFIED' : log.status} />
                    </td>
                    <td><span className="code-pill">{log.externalMessageId}</span></td>
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

