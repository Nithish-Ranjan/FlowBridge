
import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  Edit2,
  FileText,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  X,
  Send,
  BrainCircuit,
  Clock3,
  Loader2,
  Sparkles,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import { formatINR, parsePaise } from '@flowbridge/shared';
import {
  api,
  type RetailerDTO,
  type RetailerPaymentIdentifierDTO,
  type CustomerInvoiceDTO,
  type PaymentTransactionDTO,
  type PaymentAllocationDTO,
  type WorkspacePayload,
  type PaymentDelayPredictionResponse,
} from '../api/client';
import { PaymentDelayPredictionPanel } from './PaymentDelayPredictionPanel';
import { WhatsAppMessageModal, type WhatsAppTemplateType } from './WhatsAppMessageModal';

interface RetailersViewProps {
  workspace: WorkspacePayload;
  businessId: string;
  busy?: boolean;
  onRefreshWorkspace?: () => void;
  onNavigateToCommunications?: (retailerId: string) => void;
}

export const RetailersView: React.FC<RetailersViewProps> = ({
  workspace,
  businessId,
  busy = false,
  onRefreshWorkspace,
  onNavigateToCommunications,
}) => {
  const [retailers, setRetailers] = useState<RetailerDTO[]>(workspace.retailers || []);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'CRITICAL' | 'ELEVATED' | 'MEDIUM' | 'LOW'>('ALL');

  // Add Retailer Modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addName, setAddName] = useState('');
  const [addContact, setAddContact] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addTerms, setAddTerms] = useState(15);
  const [addLimitRupees, setAddLimitRupees] = useState('150000');
  const [addNotes, setAddNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit Retailer Modal
  const [editingRetailer, setEditingRetailer] = useState<RetailerDTO | null>(null);
  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editTerms, setEditTerms] = useState(15);
  const [editStatus, setEditStatus] = useState<'ACTIVE' | 'HOLD' | 'INACTIVE'>('ACTIVE');
  const [editNotes, setEditNotes] = useState('');

  // Retailer Profile Modal / Drawer
  const [selectedRetailer, setSelectedRetailer] = useState<RetailerDTO | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileIdentifiers, setProfileIdentifiers] = useState<RetailerPaymentIdentifierDTO[]>([]);
  const [profileInvoices, setProfileInvoices] = useState<CustomerInvoiceDTO[]>([]);
  const [profilePayments, setProfilePayments] = useState<PaymentTransactionDTO[]>([]);
  const [profileStats, setProfileStats] = useState<{
    totalInvoicedPaise: string;
    totalCollectedPaise: string;
    outstandingBalancePaise: string;
    unappliedCreditPaise: string;
  } | null>(null);

  // WhatsApp Message Preparation Modal
  const [whatsAppModal, setWhatsAppModal] = useState<{
    isOpen: boolean;
    retailerId?: string;
    invoiceId?: string;
    templateType?: WhatsAppTemplateType;
  }>({ isOpen: false });

  // Keep state synced with workspace
  useEffect(() => {
    setRetailers(workspace.retailers || []);
  }, [workspace.retailers]);

  // Load individual retailer profile dossier
  const handleOpenProfile = async (ret: RetailerDTO) => {
    setSelectedRetailer(ret);
    setProfileLoading(true);
    try {
      const [detailRes, ledgerRes, paymentRes] = await Promise.all([
        api.getRetailer(businessId, ret.id),
        api.getRetailerLedger(businessId, ret.id).catch(() => null),
        api.getRetailerPaymentHistory(businessId, ret.id).catch(() => null),
      ]);

      setProfileIdentifiers(detailRes.identifiers || []);

      if (ledgerRes) {
        setProfileInvoices(ledgerRes.invoices || []);
        setProfileStats({
          totalInvoicedPaise: ledgerRes.totalInvoicedPaise,
          totalCollectedPaise: ledgerRes.totalCollectedPaise,
          outstandingBalancePaise: ledgerRes.outstandingBalancePaise,
          unappliedCreditPaise: ledgerRes.unappliedCreditPaise,
        });
      } else {
        const invs = workspace.invoices.filter((i) => i.retailerId === ret.id);
        setProfileInvoices(invs);
      }

      if (paymentRes) {
        setProfilePayments(paymentRes.payments || []);
      } else {
        const txs = workspace.transactions.filter((t) => t.matchedRetailerId === ret.id);
        setProfilePayments(txs);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleCreateRetailer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setSubmitting(true);
    try {
      const generatedCode = addCode.trim() || `RET-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      await api.createRetailer(businessId, {
        retailerCode: generatedCode,
        name: addName.trim(),
        contactName: addContact.trim() || undefined,
        phoneMasked: addPhone.trim() || undefined,
        contactPhone: addPhone.trim() || undefined,
        creditTermsDays: Number(addTerms) || 15,
        notes: addNotes.trim() || undefined,
      });

      setIsAddOpen(false);
      setAddCode('');
      setAddName('');
      setAddContact('');
      setAddPhone('');
      setAddEmail('');
      setAddNotes('');

      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (err: any) {
      alert(`Error creating retailer: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (ret: RetailerDTO, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingRetailer(ret);
    setEditName(ret.name);
    setEditContact(ret.contactName || '');
    setEditTerms(ret.creditTermsDays);
    setEditStatus(ret.status as any);
    setEditNotes(ret.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRetailer) return;
    setSubmitting(true);
    try {
      await api.updateRetailer(businessId, editingRetailer.id, {
        name: editName.trim(),
        contactName: editContact.trim() || undefined,
        creditTermsDays: Number(editTerms) || 15,
        status: editStatus,
      });

      setEditingRetailer(null);
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (err: any) {
      alert(`Error updating retailer: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to categorize risk
  const getRiskTier = (score: number, notes?: string | null): 'CRITICAL' | 'ELEVATED' | 'MEDIUM' | 'LOW' => {
    if (notes?.toLowerCase().includes('critical') || score < 50) return 'CRITICAL';
    if (notes?.toLowerCase().includes('elevated') || score < 70) return 'ELEVATED';
    if (score < 85) return 'MEDIUM';
    return 'LOW';
  };

  // Filter retailers
  const filtered = retailers.filter((r) => {
    const q = search.toLowerCase();
    const matchesSearch =
      r.name.toLowerCase().includes(q) ||
      r.retailerCode.toLowerCase().includes(q) ||
      (r.contactName && r.contactName.toLowerCase().includes(q)) ||
      (r.phoneMasked && r.phoneMasked.includes(q));

    if (!matchesSearch) return false;

    if (riskFilter === 'ALL') return true;
    const tier = getRiskTier(r.reliabilityScore, r.notes);
    return tier === riskFilter;
  });

  return (
    <div className="space-y-6" style={{ padding: '0 0 32px' }}>
      {/* ── HEADER ── */}
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
            <Users size={20} color="#2563EB" />
            <span>Retailer Credit Intelligence Directory</span>
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Manage retailer customer accounts, credit limit exposure, payment discipline, and real-time risk indicators.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={16} /> Add Retailer Account
        </button>
      </div>

      {/* ── SEARCH & RISK FILTER BAR ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ position: 'relative', width: 320, maxWidth: '100%' }}>
          <Search size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: 11 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by shop name, contact, phone..."
            style={{
              width: '100%',
              paddingLeft: 34,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              fontSize: '0.82rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-alt)',
            }}
          />
        </div>

        {/* Risk Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(['ALL', 'CRITICAL', 'ELEVATED', 'MEDIUM', 'LOW'] as const).map((tier) => (
            <button
              key={tier}
              onClick={() => setRiskFilter(tier)}
              className={`btn btn-sm ${riskFilter === tier ? 'btn-primary' : ''}`}
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: '8px',
                background: riskFilter === tier ? 'var(--primary)' : 'var(--surface-alt)',
                border: riskFilter === tier ? 'none' : '1px solid var(--border)',
                color: riskFilter === tier ? '#FFFFFF' : 'var(--text-muted)',
              }}
            >
              {tier} {tier !== 'ALL' ? 'RISK' : ''}
            </button>
          ))}
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 8 }}>
            {filtered.length} Accounts
          </span>
        </div>
      </div>

      {/* ── RETAILERS GRID CARDS ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '18px',
        }}
      >
        {filtered.map((ret) => {
          const tier = getRiskTier(ret.reliabilityScore, ret.notes);
          const isCritical = tier === 'CRITICAL';
          const isElevated = tier === 'ELEVATED';

          // Invoices for this retailer
          const retailerInvoices = workspace.invoices.filter((i) => i.retailerId === ret.id);
          const outstandingPaise = retailerInvoices.reduce((sum, inv) => {
            if (inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') return sum;
            return sum + parsePaise(inv.outstandingPaise || '0');
          }, 0n);

          const overduePaise = retailerInvoices.reduce((sum, inv) => {
            if (inv.status !== 'OPEN' || inv.dueDate >= workspace.business.openingCashDate) return sum;
            return sum + parsePaise(inv.outstandingPaise || '0');
          }, 0n);

          // Simulated credit limit based on terms
          const limitRupees = 150000;
          const outstandingRupees = Number(outstandingPaise) / 100;
          const utilizationPct = Math.min(100, Math.round((outstandingRupees / limitRupees) * 100));

          return (
            <div
              key={ret.id}
              onClick={() => handleOpenProfile(ret)}
              className="card-retailer"
              style={{
                background: isCritical ? '#FFF1F2' : 'var(--surface)',
                borderRadius: '16px',
                border: `1px solid ${isCritical ? '#FECDD3' : 'var(--border)'}`,
                padding: '20px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.2s ease',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '0.98rem',
                        fontWeight: 800,
                        color: 'var(--text)',
                        lineHeight: 1.3,
                      }}
                    >
                      {ret.name}
                    </h3>
                    <p style={{ margin: '3px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      <span>{ret.contactName || 'Owner'}</span>
                      {ret.phoneMasked && <span> • {ret.phoneMasked}</span>}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        color: isCritical ? '#E11D48' : isElevated ? '#D97706' : '#16A34A',
                        background: isCritical ? '#FFE4E6' : isElevated ? '#FEF3C7' : '#DCFCE7',
                        border: `1px solid ${isCritical ? '#FDA4AF' : isElevated ? '#FDE68A' : '#BBF7D0'}`,
                      }}
                    >
                      {tier} RISK
                    </span>
                    <button
                      onClick={(e) => handleOpenEdit(ret, e)}
                      title="Edit Retailer Settings"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '4px',
                      }}
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Balances & Credit Bar */}
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Current Balance:</span>
                    <span style={{ fontWeight: 800, color: 'var(--text)' }}>
                      {formatINR(outstandingPaise.toString())}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem',
                      fontFamily: 'monospace',
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Overdue:</span>
                    <span style={{ fontWeight: 700, color: overduePaise > 0n ? '#DC2626' : 'var(--text-muted)' }}>
                      {formatINR(overduePaise.toString())}
                    </span>
                  </div>

                  {/* Credit Utilization Bar */}
                  <div style={{ marginTop: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.68rem',
                        color: 'var(--text-muted)',
                        fontFamily: 'monospace',
                        marginBottom: 4,
                      }}
                    >
                      <span>Credit Utilized</span>
                      <span>
                        {utilizationPct}% of ₹{limitRupees.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${utilizationPct}%`,
                          background: utilizationPct > 85 ? '#DC2626' : utilizationPct > 60 ? '#F59E0B' : '#16A34A',
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Risk Reasons / Discipline Diagnosis */}
                <div
                  style={{
                    marginTop: 14,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'var(--surface-alt)',
                    border: '1px solid var(--border)',
                    fontSize: '0.74rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.64rem', color: 'var(--text-muted)', display: 'block' }}>
                    Discipline Diagnosis
                  </span>
                  <p style={{ margin: '2px 0 0', lineHeight: 1.4, color: 'var(--text)' }}>
                    {ret.notes || 'Consistent timely settlement track record.'}
                  </p>
                </div>
              </div>

              {/* Footer View Dossier & WhatsApp Trigger */}
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--primary)' }}>
                  <span>View Full Profile</span>
                  <ChevronRight size={15} />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWhatsAppModal({
                      isOpen: true,
                      retailerId: ret.id,
                      templateType: overduePaise > 0n ? 'OVERDUE_REMINDER' : 'UPCOMING_REMINDER',
                    });
                  }}
                  className="btn btn-sm"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    background: '#16A34A',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  title="Prepare personalized WhatsApp message"
                >
                  <MessageSquare size={13} /> WhatsApp
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── ADD RETAILER MODAL ── */}
      {isAddOpen && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            className="modal-dialog"
            style={{
              background: 'var(--surface)',
              borderRadius: '16px',
              maxWidth: 540,
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Add New Retailer Account</h3>
              <button
                onClick={() => setIsAddOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateRetailer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Retailer Code</label>
                  <input
                    type="text"
                    placeholder="e.g. RET-13"
                    value={addCode}
                    onChange={(e) => setAddCode(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Shop / Business Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Pooja Supermarket"
                    required
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Contact Person</label>
                  <input
                    type="text"
                    placeholder="e.g. Pooja Agarwal"
                    value={addContact}
                    onChange={(e) => setAddContact(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Phone (WhatsApp)</label>
                  <input
                    type="text"
                    placeholder="e.g. +91 98200 11223"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Credit Terms (Days)</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={addTerms}
                    onChange={(e) => setAddTerms(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Credit Limit (₹)</label>
                  <input
                    type="number"
                    step={10000}
                    value={addLimitRupees}
                    onChange={(e) => setAddLimitRupees(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Discipline / Risk Notes</label>
                <textarea
                  rows={2}
                  placeholder="Notes on payment behavior, credit limits, or terms..."
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setIsAddOpen(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Creating...' : 'Register Retailer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT RETAILER MODAL ── */}
      {editingRetailer && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            className="modal-dialog"
            style={{
              background: 'var(--surface)',
              borderRadius: '16px',
              maxWidth: 480,
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Edit Retailer Account</h3>
              <button
                onClick={() => setEditingRetailer(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Shop Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Contact Person</label>
                  <input
                    type="text"
                    value={editContact}
                    onChange={(e) => setEditContact(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Credit Terms (Days)</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={editTerms}
                    onChange={(e) => setEditTerms(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="field">
                <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>Account Status</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="HOLD">CREDIT HOLD</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setEditingRetailer(null)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── RETAILER PROFILE DRAWER / MODAL ── */}
      {selectedRetailer && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            className="modal-dialog"
            style={{
              background: 'var(--surface)',
              borderRadius: '16px',
              maxWidth: 720,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>{selectedRetailer.name}</h3>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: 'var(--primary-soft)',
                      color: 'var(--primary)',
                      border: '1px solid var(--primary-border)',
                    }}
                  >
                    {selectedRetailer.retailerCode}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Contact: {selectedRetailer.contactName || 'Owner'} • Phone: {selectedRetailer.phoneMasked || 'N/A'} • Terms: {selectedRetailer.creditTermsDays} Days
                </p>
              </div>

              <button
                onClick={() => setSelectedRetailer(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {profileLoading ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading retailer financial ledger & verified identifiers...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Financial Summary Strip */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: 10,
                    padding: '14px',
                    borderRadius: '12px',
                    background: 'var(--surface-alt)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Outstanding
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#DC2626', fontFamily: 'monospace' }}>
                      {formatINR(profileStats?.outstandingBalancePaise || '0')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Total Invoiced
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>
                      {formatINR(profileStats?.totalInvoicedPaise || '0')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Total Collected
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#16A34A', fontFamily: 'monospace' }}>
                      {formatINR(profileStats?.totalCollectedPaise || '0')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Reliability Score
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)', fontFamily: 'monospace' }}>
                      {selectedRetailer.reliabilityScore}%
                    </div>
                  </div>
                </div>

                {/* Risk Diagnosis */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background: '#FFFBEB',
                    border: '1px solid #FDE68A',
                    fontSize: '0.8rem',
                    color: '#92400E',
                  }}
                >
                  <span style={{ fontWeight: 800, textTransform: 'uppercase', fontSize: '0.68rem', display: 'block' }}>
                    Credit Risk & Behavior Assessment
                  </span>
                  <p style={{ margin: '2px 0 0', lineHeight: 1.5 }}>
                    {selectedRetailer.notes || 'No adverse payment issues recorded. High settlement consistency.'}
                  </p>
                </div>

                {/* AI Payment Delay Prediction */}
                <PaymentDelayPredictionPanel
                  businessId={businessId}
                  retailer={selectedRetailer}
                />

                {/* Verified Payment Identifiers */}
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '0.86rem', fontWeight: 800 }}>
                    Verified Payment Identifiers (Zero-PII Hashed)
                  </h4>
                  {profileIdentifiers.length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No payment identifiers registered yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {profileIdentifiers.map((id) => (
                        <div
                          key={id.id}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'var(--surface-alt)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 700 }}>{id.displayLabel}</span>
                            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontFamily: 'monospace' }}>
                              {id.maskedValue}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              color: id.verifiedAt ? '#16A34A' : '#D97706',
                              background: id.verifiedAt ? '#DCFCE7' : '#FEF3C7',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {id.verifiedAt ? 'VERIFIED' : 'UNVERIFIED'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Invoices List */}
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '0.86rem', fontWeight: 800 }}>Invoices & Due Dates</h4>
                  {profileInvoices.length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No invoices found.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {profileInvoices.map((inv) => (
                        <div
                          key={inv.id}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'var(--surface-alt)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{inv.invoiceNumber}</span>
                            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>Due: {inv.dueDate}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                              {formatINR(inv.outstandingPaise)}
                            </span>
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: inv.status === 'PAID' ? '#DCFCE7' : inv.status === 'OPEN' ? '#FEF3C7' : '#F1F5F9',
                                color: inv.status === 'PAID' ? '#16A34A' : inv.status === 'OPEN' ? '#D97706' : '#64748B',
                              }}
                            >
                              {inv.status}
                            </span>
                            {inv.status === 'OPEN' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setWhatsAppModal({
                                    isOpen: true,
                                    retailerId: selectedRetailer.id,
                                    invoiceId: inv.id,
                                    templateType: inv.dueDate < workspace.business.openingCashDate ? 'OVERDUE_REMINDER' : 'UPCOMING_REMINDER',
                                  });
                                }}
                                style={{
                                  background: '#DCFCE7',
                                  border: '1px solid #86EFAC',
                                  color: '#166534',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  padding: '2px 6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                }}
                                title="Prepare WhatsApp message for this invoice"
                              >
                                <MessageSquare size={12} /> WhatsApp
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const hasOverdue = profileInvoices.some(
                        (i) => i.status === 'OPEN' && i.dueDate < workspace.business.openingCashDate,
                      );
                      setWhatsAppModal({
                        isOpen: true,
                        retailerId: selectedRetailer.id,
                        templateType: hasOverdue ? 'OVERDUE_REMINDER' : 'UPCOMING_REMINDER',
                      });
                    }}
                    className="btn"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#16A34A',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 700,
                    }}
                  >
                    <MessageSquare size={14} /> Prepare WhatsApp Message
                  </button>
                  {onNavigateToCommunications && (
                    <button
                      onClick={() => {
                        setSelectedRetailer(null);
                        onNavigateToCommunications(selectedRetailer.id);
                      }}
                      className="btn"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <Send size={14} /> Full Hub
                    </button>
                  )}
                  <button onClick={() => setSelectedRetailer(null)} className="btn">
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Smart WhatsApp Message Generation Modal */}
      <WhatsAppMessageModal
        isOpen={whatsAppModal.isOpen}
        onClose={() => setWhatsAppModal({ isOpen: false })}
        businessId={businessId}
        workspace={workspace}
        initialRetailerId={whatsAppModal.retailerId}
        initialInvoiceId={whatsAppModal.invoiceId}
        initialTemplateType={whatsAppModal.templateType}
        onSuccess={() => {
          if (onRefreshWorkspace) onRefreshWorkspace();
        }}
      />
    </div>
  );
};
