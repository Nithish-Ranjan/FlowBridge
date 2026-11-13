import React from 'react';
import { ArrowRight, ShieldCheck, TrendingUp, CheckCircle, Smartphone, Mail, AlertTriangle, Zap, Lock, CreditCard } from 'lucide-react';

interface LandingPageProps {
  onSignInClick: () => void;
  onGetStartedClick: () => void;
  onExploreDemoClick: () => void;
}

export function LandingPage({
  onSignInClick,
  onGetStartedClick,
  onExploreDemoClick,
}: LandingPageProps) {
  return (
    <div className="landing-shell">
      {/* ── TOP NAV BAR ────────────────────────────────────── */}
      <header className="landing-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #2563EB 0%, #0EA5A4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: '1.2rem',
              boxShadow: '0 4px 10px rgba(37, 99, 235, 0.25)',
            }}
          >
            FB
          </div>
          <div>
            <span style={{ fontWeight: 800, fontSize: '1.3rem', color: 'var(--text)', letterSpacing: '-0.5px' }}>
              FlowBridge
            </span>
            <span style={{ marginLeft: 6, fontSize: '0.72rem', background: 'var(--primary-soft)', color: 'var(--primary)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
              FINTECH
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <nav style={{ display: 'flex', gap: 18, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-muted)' }}>
            <a href="#features" style={{ color: 'inherit', textDecoration: 'none' }}>Features</a>
            <a href="#how-it-works" style={{ color: 'inherit', textDecoration: 'none' }}>How It Works</a>
            <a href="#integrations" style={{ color: 'inherit', textDecoration: 'none' }}>Integrations</a>
            <a href="#security" style={{ color: 'inherit', textDecoration: 'none' }}>Security</a>
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn" onClick={onSignInClick} style={{ fontWeight: 600 }}>
              Sign In
            </button>
            <button className="btn btn-primary" onClick={onGetStartedClick} style={{ fontWeight: 700 }}>
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO SECTION ───────────────────────────────────── */}
      <section className="landing-hero">
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--primary-soft)', border: '1px solid var(--primary-border)', padding: '6px 14px', borderRadius: 999, marginBottom: 18 }}>
            <Zap size={15} color="#2563EB" />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary)' }}>
              Cash Gap Resolution & Financial Intelligence Operating System
            </span>
          </div>

          <h1 style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.03em', color: 'var(--text)', margin: '0 0 16px' }}>
            Take Control of Your Business Cash Flow.
          </h1>

          <p style={{ fontSize: '1.15rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 28px', maxWidth: 540 }}>
            Know where your money is, what needs attention, and what to do next. Built specifically for FMCG and wholesale distributors facing supplier payment timing mismatches.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 32 }}>
            <button className="btn btn-primary btn-lg" onClick={onGetStartedClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Get Started Free <ArrowRight size={18} />
            </button>
            <button className="btn btn-lg" onClick={onExploreDemoClick} style={{ background: '#FFFFFF', borderColor: 'var(--border)', color: 'var(--primary)', fontWeight: 700 }}>
              ⚡ Launch 1-Click Demo
            </button>
          </div>

          {/* 3 Compact Benefit Statements */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <div className="benefit-pill">
              <CheckCircle size={15} color="#16A34A" /> Predict cash shortages 15 days ahead
            </div>
            <div className="benefit-pill">
              <CheckCircle size={15} color="#16A34A" /> Understand customer payment reliability
            </div>
            <div className="benefit-pill">
              <CheckCircle size={15} color="#16A34A" /> Resolve cash gaps intelligently
            </div>
          </div>
        </div>

        {/* ── RIGHT: FLOATING 3D FINTECH PREVIEW CARD ─────── */}
        <div>
          <div className="landing-floating-preview">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Cash Trajectory · 15-Day Radar
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>
                  ₹80,000 <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--green)' }}>Safe Day 0</span>
                </div>
              </div>
              <span className="badge badge-success">● Engine Live</span>
            </div>

            {/* SVG Visual Chart Curve */}
            <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '14px 10px', marginBottom: 14, border: '1px solid #E2E8F0' }}>
              <svg viewBox="0 0 400 120" style={{ width: '100%', height: 110, overflow: 'visible' }}>
                <defs>
                  <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Horizontal reference baseline at 0 */}
                <line x1="20" y1="80" x2="380" y2="80" stroke="#CBD5E1" strokeDasharray="3 3" />
                <text x="382" y="83" fontSize="8" fill="#94A3B8">₹0 Limit</text>

                {/* Cash Curve showing initial dip on Day 5 and recovery */}
                <path
                  d="M 20 40 Q 80 50 140 105 T 260 60 T 380 35 L 380 115 L 20 115 Z"
                  fill="url(#chartGrad)"
                />
                <path
                  d="M 20 40 Q 80 50 140 105 T 260 60 T 380 35"
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="3"
                  strokeLinecap="round"
                />

                {/* Day 5 Breach Circle */}
                <circle cx="140" cy="105" r="5" fill="#DC2626" />
                {/* Day 10 Recovery Circle */}
                <circle cx="260" cy="60" r="5" fill="#16A34A" />
              </svg>
            </div>

            {/* Shortage Warning Tag */}
            <div style={{ background: 'var(--rose-soft)', border: '1px solid var(--rose-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={18} color="#DC2626" />
              <div style={{ fontSize: '0.82rem', color: '#991B1B' }}>
                <strong>Cash Gap Detected on Day 5:</strong> Deficit of ₹24,000 due to Supplier Bill S-2041.
              </div>
            </div>

            {/* Recommended Action Card */}
            <div style={{ background: '#FFFFFF', border: '1px solid var(--primary-border)', borderRadius: 8, padding: '12px 14px', boxShadow: '0 2px 8px rgba(37,99,235,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>
                  🎯 Autopilot Recommendation
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--green)' }}>Resolves 100% Gap</span>
              </div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                1. Request ₹20,000 Early Receipt from Customer A
              </div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>
                2. Defer ₹10,000 on Supplier Bill S-2041 by 4 days
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KEY CAPABILITIES ───────────────────────────────── */}
      <section id="features" style={{ background: '#FFFFFF', padding: '70px 24px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary)', letterSpacing: '0.08em' }}>
              Built for Scale & Precision
            </span>
            <h2 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text)', margin: '8px 0 12px' }}>
              Financial Intelligence That Protects Every Rupee
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', maxWidth: 640, margin: '0 auto' }}>
              Unlike generic accounting tools that merely look backwards, FlowBridge predicts future liquidity traps and executes counter-measures before checks bounce.
            </p>
          </div>

          <div className="landing-features-grid">
            <div className="landing-feature-card">
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <TrendingUp size={22} color="#2563EB" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 8px' }}>15-Day Cash Gap Radar</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>
                Continuous simulation combining unconfirmed invoices, confirmed commitments, operating expenses, and supplier terms with exact rupee accuracy.
              </p>
            </div>

            <div className="landing-feature-card">
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--teal-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Zap size={22} color="#0EA5A4" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 8px' }}>Resolution Autopilot</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>
                Evaluates early collection discounts, supplier deferrals, and expense re-timing to find the optimal combination that protects cash without alienating partners.
              </p>
            </div>

            <div className="landing-feature-card">
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <ShieldCheck size={22} color="#16A34A" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 8px' }}>Emergency Reserve Protection</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>
                Safeguards statutory, payroll, and emergency buffers with automated sweep policies. The autopilot cannot touch locked reserve funds.
              </p>
            </div>

            <div className="landing-feature-card">
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--violet-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Smartphone size={22} color="#7C3AED" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 8px' }}>WhatsApp & Email Delivery</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>
                Mode A direct WhatsApp Web (wa.me) handoff for immediate mobile engagement, plus Meta Cloud API integration and Nodemailer SMTP dispatch.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS: 8-STAGE WORKFLOW ─────────────────── */}
      <section id="how-it-works" style={{ padding: '70px 24px', maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--secondary)', letterSpacing: '0.08em' }}>
            Structured Methodology
          </span>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text)', margin: '8px 0 12px' }}>
            The 8-Stage Cash Flow Lifecycle
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', maxWidth: 600, margin: '0 auto' }}>
            A disciplined financial operating system that guides your business from detection to resolution.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {[
            { step: '01', title: 'PREDICT', desc: 'Forecast daily balances across the rolling 15-day horizon.' },
            { step: '02', title: 'EXPLAIN', desc: 'Identify the exact invoices and supplier bills causing cash gaps.' },
            { step: '03', title: 'NEGOTIATE', desc: 'Structured counteroffers and revised payment schedules.' },
            { step: '04', title: 'RESOLVE', desc: 'Mathematical autopilot balancing early receipt and deferrals.' },
            { step: '05', title: 'PROTECT', desc: 'Ringfence minimum threshold and emergency reserves.' },
            { step: '06', title: 'TRACK', desc: 'Record commitments and watch real-time fulfillment status.' },
            { step: '07', title: 'VERIFY', desc: 'Reconcile bank SMS and UPI credits against pending invoices.' },
            { step: '08', title: 'AUTOMATE', desc: 'Queue reminders, PDF invoices, and risk alerts automatically.' },
          ].map((item) => (
            <div key={item.step} style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 6 }}>
                PHASE {item.step}
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                {item.title}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {item.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── REAL INTEGRATIONS & SECURITY BANNER ────────────── */}
      <section id="security" style={{ background: 'linear-gradient(135deg, #172554 0%, #1E3A8A 100%)', color: '#FFFFFF', padding: '60px 24px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', padding: '4px 12px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600, marginBottom: 16 }}>
              <Lock size={14} color="#60A5FA" /> Enterprise Grade Reliability
            </div>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-0.02em' }}>
              Real Indian Banking & Communication Integrations
            </h2>
            <p style={{ color: '#BFDBFE', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 24px' }}>
              No fake automation or fragile screen-scraping. FlowBridge ingests real SMS notifications from HDFC, ICICI, SBI, Axis, and Kotak, matches UPI reference IDs, and connects to your own SMTP server.
            </p>
            <div style={{ display: 'flex', gap: 14 }}>
              <button className="btn btn-primary" onClick={onGetStartedClick} style={{ background: '#2563EB', borderColor: '#3B82F6', fontWeight: 700 }}>
                Start Now
              </button>
              <button className="btn" onClick={onSignInClick} style={{ background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.2)', color: '#FFFFFF' }}>
                Sign In
              </button>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.12)', padding: 24 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <CreditCard size={20} color="#38BDF8" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Integer Paise Accounting</div>
                  <div style={{ fontSize: '0.78rem', color: '#93C5FD' }}>All financial calculations stored in BIGINT paise (INR * 100) — eliminating IEEE-754 floating-point drift.</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Mail size={20} color="#34D399" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Nodemailer Direct SMTP</div>
                  <div style={{ fontSize: '0.78rem', color: '#93C5FD' }}>Connect Gmail, Outlook, or Amazon SES with live credentials verification and PDF dispatch.</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Smartphone size={20} color="#A78BFA" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Dual-Mode WhatsApp Dispatch</div>
                  <div style={{ fontSize: '0.78rem', color: '#93C5FD' }}>Zero-cost wa.me browser handoff or Meta Cloud API integration for automated WhatsApp delivery.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer style={{ background: '#FFFFFF', borderTop: '1px solid var(--border)', padding: '30px 24px', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>
            FlowBridge © 2026 · Financial Operating System for Distributors
          </div>
          <div>
            Built with React, TypeScript, Express & PostgreSQL · Integer Paise Precision
          </div>
        </div>
      </footer>
    </div>
  );
}

