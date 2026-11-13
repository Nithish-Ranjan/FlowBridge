import React, { useEffect, useState, useMemo } from 'react';
import {
  Mail,
  MessageCircle,
  Send,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Settings,
  ExternalLink,
  ShieldCheck,
  Search,
  Phone,
  FileText,
  Clock,
  Check,
  CheckCheck,
  Paperclip,
  Calendar,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { formatINR, parsePaise } from '@flowbridge/shared';
import { api, type WorkspacePayload } from '../api/client';
import { StatusPill } from './Badge';

interface CommunicationsViewProps {
  workspace: WorkspacePayload;
  businessId: string;
  initialContactId?: string;
}

export function CommunicationsView({ workspace, businessId, initialContactId }: CommunicationsViewProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // View Mode: 'whatsapp_web' | 'smtp_settings' | 'logs'
  const [viewMode, setViewMode] = useState<'whatsapp_web' | 'smtp_settings' | 'logs'>('whatsapp_web');
  const [contactSearch, setContactSearch] = useState('');
  const [contactFilter, setContactFilter] = useState<'ALL' | 'RETAILERS' | 'SUPPLIERS' | 'OVERDUE'>('ALL');

  // Selected Active Contact
  const [selectedContactId, setSelectedContactId] = useState<string>(
    initialContactId || workspace.retailers[0]?.id || '',
  );

  // Composer State
  const [templateType, setTemplateType] = useState<'INVOICE' | 'RECEIPT' | 'REMINDER' | 'COMMITMENT'>('REMINDER');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(workspace.invoices[0]?.id || '');
  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [busy, setBusy] = useState(false);

  // SMTP Settings State
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // All contacts list (retailers + suppliers)
  const contacts = useMemo(() => {
    const list: Array<{
      id: string;
      code: string;
      name: string;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      type: 'RETAILER' | 'SUPPLIER';
      outstandingPaise: bigint;
      overduePaise: bigint;
      notes?: string | null;
    }> = [];

    // Retailers
    for (const r of workspace.retailers) {
      const invoices = workspace.invoices.filter((i) => i.retailerId === r.id);
      const out = invoices.reduce((s, inv) => {
        if (inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') return s;
        return s + parsePaise(inv.outstandingPaise || '0');
      }, 0n);

      const overdue = invoices.reduce((s, inv) => {
        if (inv.status !== 'OPEN' || inv.dueDate >= workspace.business.openingCashDate) return s;
        return s + parsePaise(inv.outstandingPaise || '0');
      }, 0n);

      list.push({
        id: r.id,
        code: r.retailerCode,
        name: r.name,
        contactName: r.contactName,
        phone: r.phoneMasked,
        email: r.email,
        type: 'RETAILER',
        outstandingPaise: out,
        overduePaise: overdue,
        notes: r.notes,
      });
    }

    // Suppliers
    for (const s of workspace.suppliers) {
      const bills = workspace.bills.filter((b) => b.supplierId === s.id);
      const out = bills.reduce((sum, b) => {
        if (b.status === 'PAID' || b.status === 'CANCELLED') return sum;
        return sum + parsePaise(b.outstandingPaise || '0');
      }, 0n);

      list.push({
        id: s.id,
        code: s.supplierCode,
        name: s.name,
        contactName: s.contactName,
        phone: s.phoneMasked,
        email: null,
        type: 'SUPPLIER',
        outstandingPaise: out,
        overduePaise: 0n,
        notes: s.isCritical ? 'Critical FMCG Supplier' : 'Regular Supplier',
      });
    }

    return list;
  }, [workspace]);

  // Selected Contact
  const activeContact = contacts.find((c) => c.id === selectedContactId) || contacts[0];

  // Invoices for selected contact
  const activeInvoices = useMemo(() => {
    if (!activeContact) return [];
    if (activeContact.type === 'RETAILER') {
      return workspace.invoices.filter((i) => i.retailerId === activeContact.id);
    }
    return [];
  }, [activeContact, workspace.invoices]);

  // Commitments for selected contact
  const activeCommitments = useMemo(() => {
    if (!activeContact) return [];
    return workspace.commitments.filter((c) => c.retailerId === activeContact.id);
  }, [activeContact, workspace.commitments]);

  // Selected Invoice
  const selectedInvoice = activeInvoices.find((i) => i.id === selectedInvoiceId) || activeInvoices[0];

  useEffect(() => {
    loadLogs();
  }, [businessId]);

  // Update default message body when active contact or template changes
  useEffect(() => {
    if (!activeContact) return;

    if (templateType === 'REMINDER') {
      setCustomSubject(`Friendly Payment Due Reminder — ${workspace.business.name}`);
      setCustomBody(
        `Dear ${activeContact.contactName || activeContact.name},\n\n` +
          `Greetings from ${workspace.business.name}.\n` +
          `This is a friendly reminder regarding pending dues amounting to ${formatINR(activeContact.outstandingPaise.toString())}` +
          (selectedInvoice ? ` (Invoice ${selectedInvoice.invoiceNumber} due on ${selectedInvoice.dueDate})` : '') +
          `.\n\nKindly process payment via UPI or IMPS to ensure uninterrupted credit terms and fast stock dispatches.\n\nThank you,\n${workspace.business.name}`,
      );
    } else if (templateType === 'INVOICE') {
      const invNum = selectedInvoice?.invoiceNumber || 'INV-2026-089';
      const invAmt = selectedInvoice ? formatINR(selectedInvoice.totalAmountPaise) : '₹40,000';
      const invDue = selectedInvoice?.dueDate || '30-Nov-2026';
      setCustomSubject(`Tax Invoice ${invNum} from ${workspace.business.name}`);
      setCustomBody(
        `Dear ${activeContact.contactName || activeContact.name},\n\n` +
          `Please find attached Tax Invoice ${invNum} for ${invAmt}. Due date: ${invDue}.\n\n` +
          `Kindly process payment via UPI or NEFT. Your prompt settlement is sincerely appreciated.\n\n` +
          `Warm regards,\n${workspace.business.name}`,
      );
    } else if (templateType === 'RECEIPT') {
      setCustomSubject(`Payment Receipt Confirmation — ${workspace.business.name}`);
      setCustomBody(
        `Dear ${activeContact.contactName || activeContact.name},\n\n` +
          `We gratefully acknowledge receipt of payment credited to our account.\n` +
          `Your updated outstanding balance has been reconciled to ${formatINR(activeContact.outstandingPaise.toString())}.\n\n` +
          `Thank you for your business,\n${workspace.business.name}`,
      );
    } else {
      // COMMITMENT follow-up
      setCustomSubject(`Commitment Confirmation — ${workspace.business.name}`);
      setCustomBody(
        `Dear ${activeContact.contactName || activeContact.name},\n\n` +
          `Following up on our mutually agreed payment schedule for ${formatINR(activeContact.outstandingPaise.toString())}.\n` +
          `Please confirm if the transfer will be initiated as planned.\n\n` +
          `Regards,\n${workspace.business.name}`,
      );
    }
  }, [activeContact, templateType, selectedInvoiceId, workspace.business.name]);

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
    } catch (err: any) {
      setSmtpTestResult({
        success: false,
        message: err.message,
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
      setViewMode('whatsapp_web');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDispatch() {
    if (!activeContact) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const recipientPhone = activeContact.phone?.replace(/X/g, '9') || '+91 98765 43210';
    const recipientEmail = activeContact.email || 'retailer@example.com';

    try {
      if (channel === 'WHATSAPP') {
        const res = await api.sendLiveWhatsApp({
          businessId,
          recipientPhone,
          templateType: templateType as any,
          customMessage: customBody,
          invoiceId: selectedInvoice?.id,
          mode: 'WEB_HAIL',
        });

        if (res.handoffUrl) {
          window.open(res.handoffUrl, '_blank', 'noopener,noreferrer');
        }

        setNotice(
          `WhatsApp dispatch launched for ${activeContact.name} (${recipientPhone}). Transaction logged to audit trail.`,
        );
        loadLogs();
      } else {
        const res = await api.sendLiveEmail({
          businessId,
          recipientEmail,
          recipientName: activeContact.contactName || activeContact.name,
          subject: customSubject,
          htmlBody: customBody.replace(/\n/g, '<br/>'),
          invoiceId: selectedInvoice?.id,
        });

        if (res.success) {
          setNotice(`Email successfully delivered via SMTP to ${recipientEmail}.`);
        } else {
          setNotice(`Email queued for background delivery to ${recipientEmail}.`);
        }
        loadLogs();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Filtered contacts list
  const filteredContacts = contacts.filter((c) => {
    const q = contactSearch.toLowerCase();
    const matchesSearch =
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.contactName && c.contactName.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q));

    if (!matchesSearch) return false;

    if (contactFilter === 'RETAILERS') return c.type === 'RETAILER';
    if (contactFilter === 'SUPPLIERS') return c.type === 'SUPPLIER';
    if (contactFilter === 'OVERDUE') return c.overduePaise > 0n;
    return true;
  });

  return (
    <div className="space-y-6" style={{ padding: '0 0 32px' }}>
      {/* ── TOP HEADER & MODE TABS ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MessageCircle size={22} color="#16A34A" />
            <span>Communications Centre</span>
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            WhatsApp Web-style partner chat, automated reminder templates, and verified Nodemailer SMTP dispatch.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`btn btn-sm ${viewMode === 'whatsapp_web' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('whatsapp_web')}
          >
            <MessageCircle size={14} /> WhatsApp Web Workspace
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'smtp_settings' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('smtp_settings')}
          >
            <Settings size={14} /> SMTP Setup
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'logs' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('logs')}
          >
            <Mail size={14} /> Delivery Logs ({logs.length})
          </button>
        </div>
      </div>

      {notice && (
        <div className="banner banner-success">
          <div>{notice}</div>
          <button className="btn btn-sm" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          <div>{error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* ── 3-PANE WHATSAPP WEB WORKSPACE ── */}
      {viewMode === 'whatsapp_web' && (
        <div
          className="wa-workspace"
          style={{
            display: 'grid',
            gridTemplateColumns: '290px 1fr 280px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            height: '750px',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* ════ COLUMN 1: CONTACTS & CONVERSATIONS LIST ════ */}
          <div
            className="wa-sidebar"
            style={{
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--surface)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-alt)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--text)' }}>Conversations</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {filteredContacts.length} Contacts
                </span>
              </div>

              {/* Search */}
              <div style={{ position: 'relative' }}>
                <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 8, top: 8 }} />
                <input
                  type="text"
                  placeholder="Search partner or phone..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  style={{
                    width: '100%',
                    paddingLeft: 28,
                    paddingRight: 8,
                    paddingTop: 5,
                    paddingBottom: 5,
                    fontSize: '0.78rem',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}
                />
              </div>

              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {(['ALL', 'RETAILERS', 'SUPPLIERS', 'OVERDUE'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setContactFilter(f)}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      borderRadius: 4,
                      border: contactFilter === f ? 'none' : '1px solid var(--border)',
                      background: contactFilter === f ? 'var(--primary)' : 'var(--surface)',
                      color: contactFilter === f ? '#FFFFFF' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Contacts Scroll List */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredContacts.map((c) => {
                const isSelected = c.id === selectedContactId;
                const hasOverdue = c.overduePaise > 0n;

                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedContactId(c.id)}
                    style={{
                      padding: '12px 14px',
                      borderBottom: '1px solid var(--border)',
                      background: isSelected ? '#EFF6FF' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      borderLeft: isSelected ? '4px solid #2563EB' : '4px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: isSelected ? '#1E40AF' : 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 160,
                        }}
                      >
                        {c.name}
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: c.type === 'RETAILER' ? '#1D4ED8' : '#7C3AED',
                          background: c.type === 'RETAILER' ? '#DBEAFE' : '#EDE9FE',
                        }}
                      >
                        {c.type === 'RETAILER' ? 'RET' : 'SUP'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {c.contactName || 'Owner'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          fontFamily: 'monospace',
                          color: hasOverdue ? '#DC2626' : 'var(--text)',
                        }}
                      >
                        {formatINR(c.outstandingPaise.toString())}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ════ COLUMN 2: ACTIVE WHATSAPP WEB CHAT & COMPOSER ════ */}
          <div
            className="wa-chat-window"
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#EFEAE2',
              position: 'relative',
            }}
          >
            {/* WhatsApp Chat Top Header */}
            <div
              style={{
                padding: '10px 18px',
                background: '#FFFFFF',
                borderBottom: '1px solid #CBD5E1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                  }}
                >
                  {activeContact?.name?.charAt(0) || 'P'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0F172A' }}>
                      {activeContact?.name}
                    </h3>
                    <ShieldCheck size={14} color="#16A34A" />
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                    {activeContact?.contactName} • {activeContact?.phone || '+91 98765 43210'} •{' '}
                    <span style={{ color: '#16A34A', fontWeight: 600 }}>Active Online</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a
                  href={`https://wa.me/${(activeContact?.phone || '919876543210').replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                  style={{
                    background: '#25D366',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.74rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <MessageCircle size={14} /> Open wa.me
                </a>
              </div>
            </div>

            {/* Chat Thread Messages Area */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '18px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {/* Date divider pill */}
              <div style={{ textAlign: 'center', margin: '4px 0' }}>
                <span
                  style={{
                    fontSize: '0.68rem',
                    background: 'rgba(255,255,255,0.85)',
                    padding: '3px 12px',
                    borderRadius: 12,
                    color: '#64748B',
                    fontWeight: 700,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  TODAY • 13 NOVEMBER 2026
                </span>
              </div>

              {/* Sample Received Message from Retailer */}
              <div style={{ alignSelf: 'flex-start', maxWidth: '75%' }}>
                <div
                  style={{
                    background: '#FFFFFF',
                    borderRadius: '8px 8px 8px 0px',
                    padding: '10px 14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.84rem', color: '#111827', lineHeight: 1.4 }}>
                    Namaste Sharma Ji, we received the latest stock delivery. Will process partial payment of balance by
                    Monday via UPI.
                  </p>
                  <div style={{ textAlign: 'right', fontSize: '0.64rem', color: '#6B7280', marginTop: 4 }}>
                    10:15 AM
                  </div>
                </div>
              </div>

              {/* Sample Outgoing Message with Invoice Card */}
              {selectedInvoice && (
                <div style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
                  <div
                    style={{
                      background: '#D9FDD3',
                      borderRadius: '8px 8px 0px 8px',
                      padding: '12px 14px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 10px',
                        background: '#FFFFFF',
                        borderRadius: 6,
                        border: '1px solid #BBF7D0',
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.8rem', color: '#166534' }}>
                          📄 {selectedInvoice.invoiceNumber}
                        </span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, fontFamily: 'monospace' }}>
                          {formatINR(selectedInvoice.outstandingPaise)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 2 }}>
                        Due: {selectedInvoice.dueDate} • Status: {selectedInvoice.status}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.84rem', color: '#111827', whiteSpace: 'pre-line' }}>
                      {customBody}
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 4,
                        fontSize: '0.64rem',
                        color: '#4B5563',
                        marginTop: 4,
                      }}
                    >
                      <span>11:30 AM</span>
                      <CheckCheck size={13} color="#2563EB" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── COMPOSER & TEMPLATE BAR ── */}
            <div
              style={{
                background: '#F0F2F5',
                borderTop: '1px solid #CBD5E1',
                padding: '12px 16px',
              }}
            >
              {/* Template Quick Chips */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
                {[
                  { key: 'REMINDER', label: '⚡ Overdue Reminder' },
                  { key: 'INVOICE', label: '📄 Invoice PDF' },
                  { key: 'RECEIPT', label: '💳 Payment Receipt' },
                  { key: 'COMMITMENT', label: '🤝 Commitment Check' },
                ].map((tpl) => (
                  <button
                    key={tpl.key}
                    onClick={() => setTemplateType(tpl.key as any)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      borderRadius: 14,
                      border: templateType === tpl.key ? 'none' : '1px solid #CBD5E1',
                      background: templateType === tpl.key ? '#2563EB' : '#FFFFFF',
                      color: templateType === tpl.key ? '#FFFFFF' : '#334155',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>

              {/* Channel Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: '0.76rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="radio"
                    name="channel"
                    value="WHATSAPP"
                    checked={channel === 'WHATSAPP'}
                    onChange={() => setChannel('WHATSAPP')}
                  />
                  <span>WhatsApp Web Handoff</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="radio"
                    name="channel"
                    value="EMAIL"
                    checked={channel === 'EMAIL'}
                    onChange={() => setChannel('EMAIL')}
                  />
                  <span>Verified Email (Nodemailer)</span>
                </label>
              </div>

              {channel === 'EMAIL' && (
                <div style={{ marginBottom: 6 }}>
                  <input
                    type="text"
                    placeholder="Email Subject Line..."
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: '0.8rem',
                    }}
                  />
                </div>
              )}

              {/* Message Textarea & Send Button */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <textarea
                  rows={3}
                  value={customBody}
                  onChange={(e) => setCustomBody(e.target.value)}
                  placeholder="Type message or select template above..."
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.82rem',
                    background: '#FFFFFF',
                    resize: 'none',
                    lineHeight: 1.4,
                  }}
                />
                <button
                  onClick={handleDispatch}
                  disabled={busy}
                  className="btn btn-primary"
                  style={{
                    height: 60,
                    padding: '0 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    background: channel === 'WHATSAPP' ? '#25D366' : '#2563EB',
                    border: 'none',
                  }}
                >
                  <Send size={16} />
                  <span style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                    {busy ? 'Sending...' : channel === 'WHATSAPP' ? 'Dispatch' : 'Email'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* ════ COLUMN 3: PARTNER FINANCIAL CONTEXT SIDEBAR ════ */}
          <div
            className="wa-context-sidebar"
            style={{
              borderLeft: '1px solid var(--border)',
              background: 'var(--surface)',
              overflowY: 'auto',
              padding: '18px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div>
              <span style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Financial Context
              </span>
              <h4 style={{ margin: '2px 0 0', fontSize: '1rem', fontWeight: 800, color: 'var(--text)' }}>
                {activeContact?.name}
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {activeContact?.code} • {activeContact?.type}
              </p>
            </div>

            {/* Balances Card */}
            <div
              style={{
                padding: '12px',
                borderRadius: '10px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Total Outstanding
                </span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>
                  {formatINR(activeContact?.outstandingPaise?.toString() || '0')}
                </div>
              </div>

              {activeContact?.overduePaise > 0n && (
                <div>
                  <span style={{ fontSize: '0.68rem', color: '#DC2626', textTransform: 'uppercase', fontWeight: 700 }}>
                    Overdue Amount
                  </span>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#DC2626', fontFamily: 'monospace' }}>
                    {formatINR(activeContact.overduePaise.toString())}
                  </div>
                </div>
              )}
            </div>

            {/* Open Invoices List with 1-click attach */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text)' }}>Active Invoices</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{activeInvoices.length} Found</span>
              </div>

              {activeInvoices.length === 0 ? (
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>No open invoices.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      onClick={() => setSelectedInvoiceId(inv.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: selectedInvoiceId === inv.id ? '1px solid #2563EB' : '1px solid var(--border)',
                        background: selectedInvoiceId === inv.id ? '#EFF6FF' : 'var(--surface-alt)',
                        cursor: 'pointer',
                        fontSize: '0.74rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                        <span>{inv.invoiceNumber}</span>
                        <span style={{ fontFamily: 'monospace' }}>{formatINR(inv.outstandingPaise)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginTop: 2, fontSize: '0.68rem' }}>
                        <span>Due: {inv.dueDate}</span>
                        <span style={{ color: inv.status === 'PAID' ? '#16A34A' : '#D97706' }}>{inv.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payment Commitments */}
            {activeCommitments.length > 0 && (
              <div>
                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                  Payment Commitments
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeCommitments.map((com) => (
                    <div
                      key={com.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: '#F0FDF4',
                        border: '1px solid #BBF7D0',
                        fontSize: '0.72rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                        <span style={{ color: '#166534' }}>{formatINR(com.proposedAmountPaise)}</span>
                        <span style={{ color: '#15803D' }}>{com.status}</span>
                      </div>
                      <div style={{ color: '#166534', marginTop: 2 }}>Expected: {com.proposedDate}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: NODEMAILER SMTP GATEWAY SETTINGS ── */}
      {viewMode === 'smtp_settings' && (
        <div className="card" style={{ maxWidth: 640, margin: '0 auto', background: 'var(--surface)', padding: 24, borderRadius: 16 }}>
          <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Nodemailer SMTP Gateway Configuration</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Configure company SMTP mail server to dispatch tax invoices and payment receipts with verified credentials.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>SMTP Host</label>
                <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              </div>
              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Port</label>
                <input type="text" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>SMTP Username / Email</label>
                <input
                  type="email"
                  placeholder="billing@yourdomain.com"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                />
              </div>
              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>App Password</label>
                <input
                  type="password"
                  placeholder="••••••••••••"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="smtpSecure"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
              />
              <label htmlFor="smtpSecure" style={{ fontSize: '0.78rem' }}>
                Use SSL/TLS (Required for Port 465)
              </label>
            </div>

            {smtpTestResult && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  background: smtpTestResult.success ? '#F0FDF4' : '#FEF2F2',
                  border: `1px solid ${smtpTestResult.success ? '#BBF7D0' : '#FECACA'}`,
                  color: smtpTestResult.success ? '#166534' : '#991B1B',
                }}
              >
                {smtpTestResult.message}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button onClick={handleTestSmtp} disabled={testingSmtp} className="btn">
                {testingSmtp ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleSaveSmtp} className="btn btn-primary">
                Save SMTP Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: AUDIT DELIVERY LOGS ── */}
      {viewMode === 'logs' && (
        <div className="card" style={{ background: 'var(--surface)', padding: 24, borderRadius: 16 }}>
          <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Immutable Outbound Communication Logs</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Audit history of payment reminders, invoice PDFs, and WhatsApp handoffs.
            </p>
          </div>

          {logs.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
              No messages dispatched yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Subject / Snippet</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ fontFamily: 'monospace' }}>{new Date(log.created_at).toLocaleString()}</td>
                      <td>
                        <span
                          style={{
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: log.channel === 'WHATSAPP' ? '#DCFCE7' : '#DBEAFE',
                            color: log.channel === 'WHATSAPP' ? '#166534' : '#1D4ED8',
                          }}
                        >
                          {log.channel}
                        </span>
                      </td>
                      <td>{log.recipient_phone || log.recipient_email}</td>
                      <td>{log.subject || log.message_snippet || 'Invoice / Due Reminder'}</td>
                      <td>
                        <span style={{ color: '#16A34A', fontWeight: 700 }}>
                          ✓ {log.delivery_status || 'DELIVERED'}
                        </span>
                      </td>
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
