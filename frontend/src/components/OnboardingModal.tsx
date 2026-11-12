import React, { useState } from 'react';
import { X, Building2, User, Phone, MapPin, Mail, Lock, ShieldCheck, ArrowRight } from 'lucide-react';
import { api, setStoredSessionToken } from '../api/client';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: any) => void;
}

export function OnboardingModal({ isOpen, onClose, onSuccess }: OnboardingModalProps) {
  const [businessName, setBusinessName] = useState('');
  const [businessCode, setBusinessCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [openingCash, setOpeningCash] = useState('80000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const openingCashPaise = Math.round((parseFloat(openingCash) || 0) * 100);
      const res = await api.onboardBusiness({
        businessName,
        businessCode: businessCode || undefined,
        ownerName,
        contactPhone,
        whatsappPhone: whatsappPhone || contactPhone,
        warehouseAddress,
        email,
        password,
        openingCashPaise,
      });

      // Login with the new account to get a session token
      const loginRes = await api.login({ email, password });
      setStoredSessionToken(loginRes.token);
      onSuccess(loginRes.user);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>
              Distributor Registration
            </h2>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              Setup your business profile to activate 15-day cash forecasting and automated collection.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="banner banner-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label><Building2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Business Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Deccan FMCG Distributors"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Business Code / Short Tag</label>
              <input
                type="text"
                placeholder="e.g. DECCAN-DIST-01"
                value={businessCode}
                onChange={(e) => setBusinessCode(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label><User size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Owner / MD Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Rajesh Sharma"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </div>

            <div className="field">
              <label><Phone size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Contact Phone (Mobile) *</label>
              <input
                type="text"
                required
                placeholder="e.g. +91 98765 43210"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label><Phone size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> WhatsApp Number</label>
              <input
                type="text"
                placeholder="e.g. +91 98765 43210"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Opening Cash Balance (₹) *</label>
              <input
                type="number"
                required
                min="0"
                step="1000"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label><MapPin size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Warehouse / Registered Address</label>
            <input
              type="text"
              placeholder="e.g. Plot 14, APMC Market Yard, Bengaluru, Karnataka - 560022"
              value={warehouseAddress}
              onChange={(e) => setWarehouseAddress(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div className="field">
              <label><Mail size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Admin Email Address *</label>
              <input
                type="email"
                required
                placeholder="owner@deccandist.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label><Lock size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Password *</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <ShieldCheck size={16} color="#16A34A" /> Stored locally with Integer Paise Precision
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {loading ? 'Creating...' : <>Complete Onboarding <ArrowRight size={16} /></>}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
