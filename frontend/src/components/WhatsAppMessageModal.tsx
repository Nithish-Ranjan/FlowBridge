import React, { useState, useEffect, useMemo } from 'react';
import {
  MessageSquare,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Phone,
  FileText,
  User,
  ShieldAlert,
  Send,
  X,
  History,
  Check,
} from 'lucide-react';
import { formatINR } from '@flowbridge/shared';
import { api, type WorkspacePayload, type RetailerDTO, type CustomerInvoiceDTO } from '../api/client';

export type WhatsAppTemplateType =
  | 'UPCOMING_REMINDER'
  | 'OVERDUE_REMINDER'
  | 'COMMITMENT_FOLLOWUP'
  | 'PAYMENT_CONFIRMATION'
  | 'PAYMENT_DISCREPANCY'
  | 'FRIENDLY_FOLLOWUP';

interface WhatsAppMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  workspace: WorkspacePayload;
  initialRetailerId?: string;
  initialInvoiceId?: string;
  initialTemplateType?: WhatsAppTemplateType;
  onSuccess?: () => void;
}

const TEMPLATE_OPTIONS: Array<{ key: WhatsAppTemplateType; label: string; description: string }> = [
  { key: 'UPCOMING_REMINDER', label: 'Upcoming Payment Reminder', description: 'Gentle reminder before invoice due date' },
  { key: 'OVERDUE_REMINDER', label: 'Overdue Payment Reminder', description: 'Formal notice for invoices past contractual credit terms' },
  { key: 'COMMITMENT_FOLLOWUP', label: 'Payment Commitment Follow-up', description: 'Follow-up on agreed payment plan or promise date' },
  { key: 'PAYMENT_CONFIRMATION', label: 'Payment Receipt Confirmation', description: 'Acknowledgment of verified payment and updated balance' },
  { key: 'PAYMENT_DISCREPANCY', label: 'Payment Discrepancy Clarification', description: 'Request advice on unmatched deposit or ambiguous reference' },
  { key: 'FRIENDLY_FOLLOWUP', label: 'Friendly Collection Check-In', description: 'Low-friction check-in on outstanding account balance' },
];

export function WhatsAppMessageModal({
  isOpen,
  onClose,
  businessId,
  workspace,
  initialRetailerId,
  initialInvoiceId,
  initialTemplateType = 'UPCOMING_REMINDER',
  onSuccess,
}: WhatsAppMessageModalProps) {
  if (!isOpen) return null;

  // Selected Retailer
  const [selectedRetailerId, setSelectedRetailerId] = useState<string>(
    initialRetailerId || workspace.retailers[0]?.id || '',
  );

  const selectedRetailer = useMemo(() => {
    return workspace.retailers.find((r) => r.id === selectedRetailerId) || workspace.retailers[0];
  }, [workspace.retailers, selectedRetailerId]);

  // Selected Template
  const [templateType, setTemplateType] = useState<WhatsAppTemplateType>(initialTemplateType);

  // Invoices for this Retailer
  const retailerInvoices = useMemo(() => {
    if (!selectedRetailer) return [];
    return workspace.invoices.filter(
      (inv) => inv.retailerId === selectedRetailer.id && inv.status !== 'CANCELLED' && inv.status !== 'WRITTEN_OFF',
    );
  }, [workspace.invoices, selectedRetailer]);

  // Selected Invoice
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(initialInvoiceId || '');

  // Message & State
  const [messageText, setMessageText] = useState<string>('');
  const [phoneOverride, setPhoneOverride] = useState<string>('');
  const [logId, setLogId] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState<any>(null);

  // Validation & UI State
  const [isValidPhone, setIsValidPhone] = useState<boolean>(true);
  const [phoneErrorMessage, setPhoneErrorMessage] = useState<string | null>(null);
  const [normalizedPhone, setNormalizedPhone] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'DRAFT' | 'OPENED' | 'CONFIRMED'>('DRAFT');

  // History Drawer
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Initialize phone override from retailer record
  useEffect(() => {
    if (selectedRetailer) {
      const existingPhone = selectedRetailer.contactPhone || selectedRetailer.phoneMasked || '';
      setPhoneOverride(existingPhone);
      setStep('DRAFT');
    }
  }, [selectedRetailer]);

  // Generate / Prepare smart message whenever retailer, template, or invoice changes
  useEffect(() => {
    if (!selectedRetailer) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .prepareWhatsAppMessage({
        businessId,
        retailerId: selectedRetailer.id,
        templateType,
        invoiceId: selectedInvoiceId || undefined,
        recipientPhoneOverride: phoneOverride.trim() || undefined,
      })
      .then((res) => {
        if (!isMounted) return;
        setMessageText(res.messageText);
        setLogId(res.logId);
        setNormalizedPhone(res.normalizedPhone);
        setIsValidPhone(res.isValidPhone);
        setPhoneErrorMessage(res.phoneErrorMessage || null);
        setContextSummary(res.contextSummary);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [businessId, selectedRetailer, templateType, selectedInvoiceId]);

  // Load Retailer WhatsApp History
  const loadHistory = async () => {
    if (!selectedRetailer) return;
    setLoadingHistory(true);
    try {
      const res = await api.getRetailerWhatsAppHistory(businessId, selectedRetailer.id);
      setHistoryLogs(res.history);
    } catch {
      // Ignored
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (showHistory && selectedRetailer) {
      loadHistory();
    }
  }, [showHistory, selectedRetailer]);

  // Regenerate message
  const handleRegenerate = async () => {
    if (!selectedRetailer) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.prepareWhatsAppMessage({
        businessId,
        retailerId: selectedRetailer.id,
        templateType,
        invoiceId: selectedInvoiceId || undefined,
        recipientPhoneOverride: phoneOverride.trim() || undefined,
      })
      setMessageText(res.messageText);
      setLogId(res.logId);
      setNormalizedPhone(res.normalizedPhone);
      setIsValidPhone(res.isValidPhone);
      setPhoneErrorMessage(res.phoneErrorMessage || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Open WhatsApp
  const handleOpenWhatsApp = async () => {
    if (!logId || !isValidPhone || !normalizedPhone) {
      setError('Please provide a valid recipient phone number before opening WhatsApp.');
      return;
    }

    setBusyAction(true);
    setError(null);

    try {
      // 1. Record that WhatsApp was opened (status: OPENED_IN_WHATSAPP)
      await api.trackWhatsAppOpened({
        businessId,
        logId,
        updatedMessageText: messageText,
        updatedRecipientPhone: phoneOverride.trim() || undefined,
      });

      // 2. Build official wa.me click-to-chat URL and launch in new window
      const encoded = encodeURIComponent(messageText);
      const waUrl = `https://wa.me/${normalizedPhone}?text=${encoded}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');

      // 3. Advance to confirmation step
      setStep('OPENED');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  // Step 2: Confirm message was sent manually by human
  const handleConfirmSent = async () => {
    if (!logId) return;

    setBusyAction(true);
    setError(null);

    try {
      await api.confirmWhatsAppSent({
        businessId,
        logId,
        note: `User confirmed manual dispatch to ${selectedRetailer?.name} (${normalizedPhone}).`,
      });

      setStep('CONFIRMED');
      if (onSuccess) onSuccess();

      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 120 }}>
      <div
        className="modal-content"
        style={{
          maxWidth: 680,
          width: '100%',
          padding: 0,
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-floating)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 22px',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(180deg, #FFFFFF 0%, var(--surface-alt) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: '#25D366',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
              }}
            >
              <MessageSquare size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>
                WhatsApp Smart Message Dispatch
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Human-Approved Sending via Official Click-to-Chat (wa.me)
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowHistory(!showHistory)}
              style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <History size={13} /> {showHistory ? 'Hide History' : 'History'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
          {error && (
            <div className="banner banner-error" style={{ marginBottom: 14 }}>
              <div>{error}</div>
              <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {/* Collapsible History Section */}
          {showHistory && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 8, color: 'var(--text)' }}>
                Previous WhatsApp Logs for {selectedRetailer?.name}
              </div>
              {loadingHistory ? (
                <div style={{ color: 'var(--text-muted)' }}>Loading logs...</div>
              ) : historyLogs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {historyLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        padding: '6px 10px',
                        background: '#FFFFFF',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong>{log.templateKey}</strong> · {new Date(log.createdAt).toLocaleDateString()}
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {log.recipientPhone}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background:
                            log.status === 'USER_CONFIRMED_SENT'
                              ? 'var(--green-soft)'
                              : log.status === 'OPENED_IN_WHATSAPP'
                              ? 'var(--amber-soft)'
                              : 'var(--surface-alt)',
                          color:
                            log.status === 'USER_CONFIRMED_SENT'
                              ? 'var(--green)'
                              : log.status === 'OPENED_IN_WHATSAPP'
                              ? 'var(--amber)'
                              : 'var(--text-muted)',
                        }}
                      >
                        {log.status === 'USER_CONFIRMED_SENT' ? '✓ SENT (CONFIRMED)' : log.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>No previous WhatsApp messages logged for this retailer.</div>
              )}
            </div>
          )}

          {/* Row 1: Target Retailer & Phone Validation */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                Retailer Counterparty
              </label>
              <select
                value={selectedRetailerId}
                onChange={(e) => {
                  setSelectedRetailerId(e.target.value);
                  setSelectedInvoiceId('');
                }}
                style={{ width: '100%', fontSize: '0.84rem' }}
              >
                {workspace.retailers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.retailerCode} · {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text)' }}>
                  WhatsApp Phone Number
                </label>
                {isValidPhone && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600 }}>
                    ✓ Valid
                  </span>
                )}
              </div>
              <input
                type="text"
                value={phoneOverride}
                onChange={(e) => setPhoneOverride(e.target.value)}
                placeholder="e.g. 98201 11223 or +91 98201 11223"
                style={{
                  width: '100%',
                  fontSize: '0.84rem',
                  borderColor: isValidPhone ? undefined : 'var(--rose)',
                }}
              />
            </div>
          </div>

          {/* Phone Warning Callout if Masked or Invalid */}
          {!isValidPhone && phoneErrorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--rose-soft)',
                border: '1px solid var(--rose-border)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 14,
                fontSize: '0.76rem',
                color: '#991B1B',
              }}
            >
              <AlertTriangle size={15} color="#DC2626" />
              <span>{phoneErrorMessage}</span>
            </div>
          )}

          {/* Row 2: Template Type & Context Invoice */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                Message Template Type
              </label>
              <select
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value as WhatsAppTemplateType)}
                style={{ width: '100%', fontSize: '0.84rem' }}
              >
                {TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                Target Invoice (Context)
              </label>
              <select
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                style={{ width: '100%', fontSize: '0.84rem' }}
              >
                <option value="">Latest / Overdue Invoice</option>
                {retailerInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    #{inv.invoiceNumber} (Due: {inv.dueDate} · {formatINR(inv.outstandingPaise)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Financial Context Pill Bar */}
          {contextSummary && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              <span>Distributor: <strong>{contextSummary.businessName}</strong></span>
              <span>•</span>
              {contextSummary.invoiceNumber && <span>Invoice: <strong>#{contextSummary.invoiceNumber}</strong></span>}
              <span>•</span>
              {contextSummary.amountPaise && <span>Pending: <strong>{formatINR(contextSummary.amountPaise)}</strong></span>}
              <span>•</span>
              {contextSummary.overdueDays > 0 ? (
                <span style={{ color: 'var(--rose)', fontWeight: 700 }}>
                  ⚠️ {contextSummary.overdueDays} days overdue
                </span>
              ) : (
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>Due {contextSummary.dueDate}</span>
              )}
            </div>
          )}

          {/* Row 3: Live Message Editor */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text)' }}>
                Message Text (Editable Preview)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-light)' }}>
                  {messageText.length} characters
                </span>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={loading}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--primary)',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <RotateCcw size={12} /> Regenerate
                </button>
              </div>
            </div>

            <textarea
              rows={8}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              disabled={loading}
              placeholder="Synthesizing personalized message..."
              style={{
                width: '100%',
                fontSize: '0.84rem',
                lineHeight: 1.5,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 2 }}>
              WhatsApp formatting supported: *bold*, _italics_, ~strikethrough~.
            </div>
          </div>

          {/* Step 2 Banner: When WhatsApp was opened */}
          {step === 'OPENED' && (
            <div
              style={{
                marginTop: 14,
                padding: '12px 14px',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
              }}
            >
              <div style={{ fontWeight: 800, color: '#166534', marginBottom: 4 }}>
                WhatsApp Opened in New Tab
              </div>
              <div style={{ color: '#15803D' }}>
                Please review the prefilled message in WhatsApp and click <strong>Send</strong>. Once you have sent it, click the confirmation button below to record the audit log.
              </div>
            </div>
          )}

          {step === 'CONFIRMED' && (
            <div
              style={{
                marginTop: 14,
                padding: '12px 14px',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#166534',
              }}
            >
              <CheckCircle2 size={16} />
              <span><strong>Logged!</strong> Message recorded as user-confirmed sent.</span>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-alt)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Strict Rule: Human approval & send are mandatory.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busyAction}>
              {step === 'CONFIRMED' ? 'Close' : 'Cancel'}
            </button>

            {step === 'DRAFT' && (
              <button
                type="button"
                className="btn btn-sm btn-emerald"
                onClick={handleOpenWhatsApp}
                disabled={!isValidPhone || loading || busyAction || !messageText.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  fontWeight: 700,
                  background: '#25D366',
                  color: '#FFFFFF',
                  borderColor: '#22C55E',
                }}
              >
                <ExternalLink size={14} /> Open in WhatsApp
              </button>
            )}

            {step === 'OPENED' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleOpenWhatsApp}
                  disabled={busyAction}
                  style={{ fontSize: '0.78rem' }}
                >
                  Re-open WhatsApp
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={handleConfirmSent}
                  disabled={busyAction}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    fontWeight: 700,
                  }}
                >
                  <Check size={14} /> I Have Sent This Message
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

