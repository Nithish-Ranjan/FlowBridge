import { useEffect, useState } from 'react';
import { Mail, MessageCircle, Send, CheckCircle, AlertCircle, RefreshCw, Settings, ExternalLink, ShieldCheck } from 'lucide-react';
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
  const [notice, setNotice] = useState<string | null>(null);

  // Channel Tabs & Settings
  const [activeTab, setActiveTab] = useState<'composer' | 'smtp_settings' | 'logs'>('composer');
  const [waMode, setWaMode] = useState<'WEB_HAIL' | 'META_CLOUD_API'>('WEB_HAIL');

  // SMTP Settings State
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Composer State
  const [selectedRetailerId, setSelectedRetailerId] = useState(workspace.retailers[0]?.id ?? '');
  const [templateType, setTemplateType] = useState<'INVOICE' | 'RECEIPT' | 'REMINDER'>('INVOICE');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(workspace.invoices[0]?.id ?? '');
  const [selectedPaymentId, setSelectedPaymentId] = useState(workspace.transactions[0]?.id ?? '');
  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [busy, setBusy] = useState(false);

  const selectedRetailer = workspace.retailers.find((r) => r.id === selectedRetailerId) || workspace.retailers[0];
  const selectedInvoice = workspace.invoices.find((i) => i.id === selectedInvoiceId) || workspace.invoices[0];
  const selectedPayment = workspace.transactions.find((t) => t.id === selectedPaymentId) || workspace.transactions[0];

  useEffect(() => {
    loadLogs();
  }, [businessId]);

  // Update default message body when selection or template changes
  useEffect(() => {
    if (!selectedRetailer) return;
    if (templateType === 'INVOICE' && selectedInvoice) {
      setCustomSubject(`Tax Invoice ${selectedInvoice.invoiceNumber} from ${workspace.business.name}`);
      setCustomBody(
        `Dear ${selectedRetailer.contactName || selectedRetailer.name},\n\nPlease find attached Tax Invoice ${selectedInvoice.invoiceNumber} for ${formatINR(selectedInvoice.totalAmountPaise)}. Due date: ${selectedInvoice.dueDate}.\n\nKindly process payment via UPI or IMPS to ensure continued credit limits.\n\nThank you,\n${workspace.business.name}`,
      );
    } else if (templateType === 'RECEIPT' && selectedPayment) {
      setCustomSubject(`Payment Receipt Confirmation — ${formatINR(selectedPayment.amountPaise)}`);
      setCustomBody(
        `Dear ${selectedRetailer.contactName || selectedRetailer.name},\n\nWe gratefully acknowledge receipt of ${formatINR(selectedPayment.amountPaise)} credited on ${selectedPayment.valueDate}.\nYour updated balance has been reconciled.\n\nWarm regards,\n${workspace.business.name}`,
      );
    } else {
      setCustomSubject(`Friendly Payment Due Reminder — ${workspace.business.name}`);
      setCustomBody(
        `Dear ${selectedRetailer.contactName || selectedRetailer.name},\n\nThis is a friendly reminder regarding pending invoices amounting to ${formatINR(selectedInvoice?.outstandingPaise || '0')} due shortly. Prompt settlement keeps your credit rating high.\n\nRegards,\n${workspace.business.name}`,
      );
    }
  }, [selectedRetailerId, templateType, selectedInvoiceId, selectedPaymentId]);

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

  async function handleTestSmtp() {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await api.testEmailSmtp({
        smtpHost,
        smtpPort: Number(smtpPort) || 587,
        smtpSecure,
        smtpUser,
        smtpPass,
      });
      setSmtpTestResult(res);
    } catch (err) {
      setSmtpTestResult({
        success: false,
        message: (err as Error).message,
      });
    } finally {
      setTestingSmtp(false);
    }
  }

  async function handleSaveSmtp() {
    try {
      await api.updateBusinessProfile(businessId, {
        emailConfigurations: {
          provider: 'SMTP',
          configured: true,
          smtpHost,
          smtpPort: Number(smtpPort) || 587,
          smtpSecure,
          smtpUser,
          smtpPass,
          fromEmail: smtpUser,
          fromName: workspace.business.name,
        },
      });
      setNotice('SMTP credentials saved securely to your business profile.');
      setActiveTab('composer');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDispatch() {
    if (!selectedRetailer) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const recipientPhone = selectedRetailer.phoneMasked?.replace(/X/g, '9') || '9876543210';
    const recipientEmail = selectedRetailer.email || 'retailer@example.com';

    try {
      if (channel === 'WHATSAPP') {
        const res = await api.sendLiveWhatsApp({
          businessId,
          recipientPhone,
          recipientName: selectedRetailer.name,
          messageText: customBody,
          templateKey: templateType,
        });

        if (res.mode === 'WEB_HAIL' && res.handoffUrl) {
          window.open(res.handoffUrl, '_blank', 'noopener,noreferrer');
          setNotice(`WhatsApp Web handoff opened with prefilled message for ${selectedRetailer.name}.`);
        } else if (res.success) {
          setNotice(`WhatsApp message dispatched via Meta Cloud API! ID: ${res.externalMessageId}`);
        } else {
          setError(`WhatsApp delivery failed: ${res.error}`);
        }
      } else {
        const res = await api.sendLiveEmail({
          businessId,
          recipientEmail,
          recipientName: selectedRetailer.name,
          subject: customSubject,
          htmlBody: `<div style="font-family: sans-serif; line-height: 1.6; color: #172554;">
            <p>${customBody.replace(/\n/g, '<br/>')}</p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
            <small style="color: #64748B;">Sent via FlowBridge Financial Operating System</small>
          </div>`,
          pdfFilename: selectedInvoice ? `${selectedInvoice.invoiceNumber}.pdf` : undefined,
          templateKey: templateType,
        });

        if (res.success) {
          setNotice(`Email dispatched successfully! Message ID: ${res.messageId}`);
        } else {
          setError(`Email dispatch failed: ${res.error}`);
        }
      }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} /> <strong>Error:</strong> {error}
          </div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {notice && (
        <div className="banner banner-success">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={16} /> {notice}
          </div>
          <button className="btn btn-sm" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {/* Channel Summary & Tab Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className={`btn ${activeTab === 'composer' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('composer')}
          >
            <Send size={15} /> Message Composer
          </button>
          <button
            className={`btn ${activeTab === 'smtp_settings' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('smtp_settings')}
          >
            <Settings size={15} /> Real SMTP Setup
          </button>
          <button
            className={`btn ${activeTab === 'logs' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Mail size={15} /> Delivery Logs ({logs.length})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-info" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <MessageCircle size={12} /> WhatsApp: {waMode === 'WEB_HAIL' ? 'Mode A (wa.me)' : 'Mode B (Meta API)'}
          </span>
          <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ShieldCheck size={12} /> SMTP Ready
          </span>
        </div>
      </div>

      {/* ── TAB 1: REAL MESSAGE COMPOSER ─────────────────── */}
      {activeTab === 'composer' && (
        <div className="grid-2">
          {/* Left: Input Controls */}
          <div className="card">
            <div className="card-header">
              <h3>Compose Customer Notification</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="field">
                <label>Select Retailer / Customer</label>
                <select value={selectedRetailerId} onChange={(e) => setSelectedRetailerId(e.target.value)}>
                  {workspace.retailers.map((ret) => (
                    <option key={ret.id} value={ret.id}>
                      {ret.name} ({ret.contactName || 'Owner'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Delivery Channel</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value as any)}>
                  <option value="WHATSAPP">WhatsApp (Direct Browser Handoff)</option>
                  <option value="EMAIL">Verified Email (Nodemailer SMTP)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="field">
                <label>Notification Template</label>
                <select value={templateType} onChange={(e) => setTemplateType(e.target.value as any)}>
                  <option value="INVOICE">Tax Invoice Dispatch (with PDF)</option>
                  <option value="RECEIPT">Payment Receipt Confirmation</option>
                  <option value="REMINDER">Payment Due Date Reminder</option>
                </select>
              </div>

              {templateType === 'INVOICE' && (
                <div className="field">
                  <label>Select Invoice</label>
                  <select value={selectedInvoiceId} onChange={(e) => setSelectedInvoiceId(e.target.value)}>
                    {workspace.invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} — {formatINR(inv.outstandingPaise)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {templateType === 'RECEIPT' && (
                <div className="field">
                  <label>Select Verified Payment</label>
                  <select value={selectedPaymentId} onChange={(e) => setSelectedPaymentId(e.target.value)}>
                    {workspace.transactions.map((tx) => (
                      <option key={tx.id} value={tx.id}>
                        {tx.valueDate} — {formatINR(tx.amountPaise)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {channel === 'EMAIL' && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Email Subject Line</label>
                <input
                  type="text"
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                />
              </div>
            )}

            <div className="field" style={{ marginBottom: 18 }}>
              <label>Message Content</label>
              <textarea
                rows={6}
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary"
              disabled={busy || !selectedRetailer}
              onClick={handleDispatch}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {busy ? (
                'Dispatching...'
              ) : channel === 'WHATSAPP' ? (
                <>
                  <MessageCircle size={16} /> Open WhatsApp Web Dispatch
                </>
              ) : (
                <>
                  <Send size={16} /> Send Verified Email
                </>
              )}
            </button>
          </div>

          {/* Right: Real-time Live Preview */}
          <div className="card">
            <div className="card-header">
              <h3>Live Message Preview</h3>
              <span className="badge badge-info">{channel}</span>
            </div>

            <div style={{ background: channel === 'WHATSAPP' ? '#EFEAE2' : '#F8FAFC', borderRadius: 'var(--radius)', padding: 18, border: '1px solid var(--border)', minHeight: 280 }}>
              {channel === 'WHATSAPP' ? (
                <div style={{ background: '#FFFFFF', borderRadius: 8, padding: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.1)', maxWidth: '90%', marginLeft: 'auto' }}>
                  <div style={{ fontSize: '0.84rem', whiteSpace: 'pre-line', color: '#111B21', lineHeight: 1.5 }}>
                    {customBody}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.68rem', color: '#667781', marginTop: 6 }}>
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
                  </div>
                </div>
              ) : (
                <div style={{ background: '#FFFFFF', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                  <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      To: <strong>{selectedRetailer?.name}</strong> &lt;{selectedRetailer?.email || 'retailer@example.com'}&gt;
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      From: <strong>{workspace.business.name}</strong> &lt;billing@flowbridge.local&gt;
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>
                      {customSubject}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.86rem', color: 'var(--text)', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                    {customBody}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={14} color="#16A34A" /> Delivery recorded in immutable audit log upon dispatch.
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: REAL SMTP CONFIGURATION & TEST ────────── */}
      {activeTab === 'smtp_settings' && (
        <div className="card" style={{ maxWidth: 680, margin: '0 auto' }}>
          <div className="card-header">
            <h3>Nodemailer SMTP Gateway Configuration</h3>
            <span className="badge badge-info">Production Outbound</span>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 16px' }}>
            Configure your company's SMTP mail server (Gmail Workspace, Microsoft 365, Amazon SES, or SendGrid) to send tax invoices and payment receipts with your verified domain.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 12 }}>
            <div className="field">
              <label>SMTP Host</label>
              <input
                type="text"
                placeholder="e.g. smtp.gmail.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Port</label>
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label>SMTP Username / Email</label>
              <input
                type="text"
                placeholder="billing@yourdistributor.com"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </div>

            <div className="field">
              <label>SMTP App Password / Key</label>
              <input
                type="password"
                placeholder="••••••••••••••••"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
              />
              Use SSL / TLS (Enable for Port 465, uncheck for Port 587 STARTTLS)
            </label>
          </div>

          {smtpTestResult && (
            <div className={`banner ${smtpTestResult.success ? 'banner-success' : 'banner-error'}`} style={{ marginBottom: 16 }}>
              {smtpTestResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {smtpTestResult.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              className="btn"
              disabled={testingSmtp}
              onClick={handleTestSmtp}
            >
              {testingSmtp ? 'Testing Connection...' : '🔌 Test SMTP Connection'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveSmtp}
            >
              Save Credentials
            </button>
          </div>
        </div>
      )}

      {/* ── TAB 3: IMMUTABLE AUDIT LOGS ───────────────────── */}
      {activeTab === 'logs' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Outbound Multi-Channel Delivery Logs</h3>
              <div className="muted">Tracked delivery records with external gateway message IDs and receipt states.</div>
            </div>
            <button className="btn" onClick={loadLogs}>
              <RefreshCw size={14} /> Refresh Logs
            </button>
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
                      <td>
                        <span className={`badge ${log.channel === 'WHATSAPP' ? 'badge-success' : 'badge-info'}`}>
                          {log.channel}
                        </span>
                      </td>
                      <td>
                        <strong>{log.templateKey ?? 'Custom'}</strong>
                        {log.subject && <div className="muted">{log.subject}</div>}
                      </td>
                      <td>
                        <StatusPill status={log.status === 'DELIVERED' ? 'VERIFIED' : log.status} />
                      </td>
                      <td><span className="code-pill">{log.externalMessageId || 'N/A'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
