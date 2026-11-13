import React, { useState } from 'react';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  Calendar,
  ShieldCheck,
  TrendingDown,
  Wand2,
  ChevronRight,
  Clock,
  Sparkles,
  SlidersHorizontal,
  Users,
  MessageSquare,
  FileText,
  CreditCard,
  CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { formatINR, parsePaise } from '@flowbridge/shared';
import type { DashboardResponse } from '../api/client';
import { StatCard } from './StatCard';

interface DashboardViewProps {
  dashboard: DashboardResponse;
  busy: boolean;
  onNavigate: (page: any) => void;
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  dashboard,
  busy,
  onNavigate,
  onRefresh,
}) => {
  const { workspace, forecast } = dashboard;
  const { business } = workspace;
  const { breach, days } = forecast;

  const [chartHorizon, setChartHorizon] = useState<number>(30);

  // Financial Calculations
  const openingCashPaise = parsePaise(business.openingCashPaise || '6000000');
  const minThresholdPaise = parsePaise(business.minimumCashPaise || '5000000');
  const minThresholdRupees = Number(minThresholdPaise) / 100;

  // Total Receivables
  const totalReceivablesPaise = workspace.invoices.reduce((sum, inv) => {
    if (inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') return sum;
    return sum + parsePaise(inv.outstandingPaise || '0');
  }, 0n);

  // Overdue Receivables
  const overdueInvoices = workspace.invoices.filter((inv) => {
    if (inv.status !== 'OPEN') return false;
    return inv.dueDate < business.openingCashDate;
  });
  const overdueReceivablesPaise = overdueInvoices.reduce(
    (sum, inv) => sum + parsePaise(inv.outstandingPaise || '0'),
    0n,
  );

  // Total Payables (Bills + Expenses)
  const totalBillsPaise = workspace.bills.reduce((sum, b) => {
    if (b.status === 'PAID' || b.status === 'CANCELLED') return sum;
    return sum + parsePaise(b.outstandingPaise || '0');
  }, 0n);
  const totalExpensesPaise = workspace.expenses.reduce((sum, e) => {
    if (e.status === 'PAID' || e.status === 'CANCELLED') return sum;
    return sum + parsePaise(e.outstandingPaise || '0');
  }, 0n);
  const totalPayablesPaise = totalBillsPaise + totalExpensesPaise;

  // Upcoming 7-day Outflows & Inflows
  const horizon7Date = new Date(business.openingCashDate);
  horizon7Date.setDate(horizon7Date.getDate() + 7);
  const horizon7Str = horizon7Date.toISOString().slice(0, 10);

  const upcoming7dBillsPaise = workspace.bills
    .filter((b) => b.status === 'OPEN' && b.dueDate <= horizon7Str && b.dueDate >= business.openingCashDate)
    .reduce((sum, b) => sum + parsePaise(b.outstandingPaise || '0'), 0n);

  const expected7dInflowsPaise = workspace.invoices
    .filter((i) => i.status === 'OPEN' && i.dueDate <= horizon7Str && i.dueDate >= business.openingCashDate)
    .reduce((sum, i) => sum + parsePaise(i.outstandingPaise || '0'), 0n);

  // Shortage Deficit
  const isBreached = !!breach.firstBreachDate;
  const shortagePaise = breach.shortfallPaise ? parsePaise(breach.shortfallPaise) : 0n;

  // Chart series data sliced by chartHorizon
  const chartData = days.slice(0, chartHorizon).map((d) => ({
    date: d.date.slice(5), // 'MM-DD'
    fullDate: d.date,
    dayIndex: d.dayIndex,
    balance: Math.round(Number(parsePaise(d.closingBalancePaise)) / 100),
    inflows: Math.round(Number(parsePaise(d.totalInflowsPaise)) / 100),
    outflows: Math.round(Number(parsePaise(d.totalOutflowsPaise)) / 100),
    threshold: minThresholdRupees,
  }));

  return (
    <div className="space-y-6" style={{ padding: '0 0 32px' }}>
      {/* ── DAILY FINANCIAL BRIEFING BANNER ── */}
      <div
        className="card-briefing"
        style={{
          background: 'linear-gradient(135deg, #1E3A8A 0%, #172554 100%)',
          borderRadius: '16px',
          padding: '24px 28px',
          color: '#FFFFFF',
          boxShadow: '0 10px 25px -5px rgba(30, 58, 138, 0.25)',
          position: 'relative',
          overflow: 'hidden',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  background: 'rgba(255, 255, 255, 0.15)',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#93C5FD',
                }}
              >
                <Sparkles size={14} /> Morning Financial Briefing
              </span>
              <span style={{ fontSize: '0.8rem', color: '#BFDBFE', fontFamily: 'monospace' }}>
                • Day 0: {business.openingCashDate}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => onNavigate('what-if')}
                className="btn btn-sm"
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  fontWeight: 600,
                }}
              >
                <SlidersHorizontal size={14} /> What-If Room
              </button>
              <button
                onClick={() => onNavigate('resolve')}
                className="btn btn-sm btn-primary"
                style={{
                  background: '#38BDF8',
                  color: '#0F172A',
                  fontWeight: 700,
                  border: 'none',
                  boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)',
                }}
              >
                <Wand2 size={14} /> Launch Autopilot
              </button>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '0.98rem', lineHeight: 1.6, color: '#F1F5F9', maxWidth: '900px' }}>
            {isBreached ? (
              <>
                Operating cash gap projected on{' '}
                <strong style={{ color: '#F87171', textDecoration: 'underline' }}>{breach.firstBreachDate}</strong>{' '}
                with a deficit of{' '}
                <strong style={{ color: '#FCA5A5' }}>{formatINR(shortagePaise.toString())}</strong> below minimum
                threshold ({formatINR(minThresholdPaise.toString())}). Primary driver is upcoming{' '}
                <strong>₹1,50,000 Apex Consumer Goods Ltd</strong> consignment liability.
              </>
            ) : (
              <>
                All projected cash balances remain strictly above the distributor minimum threshold (
                {formatINR(minThresholdPaise.toString())}) across the next {chartHorizon} days. Operating liquidity is
                stable.
              </>
            )}
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.82rem',
              paddingTop: 8,
              borderTop: '1px solid rgba(255, 255, 255, 0.15)',
            }}
          >
            <span style={{ color: '#38BDF8', fontWeight: 700 }}>Priority Action:</span>
            <span style={{ color: '#E2E8F0' }}>
              Request partial overdue settlement of ₹40,000 from Shree Balaji Mart (INV-2026-089) and confirm Suresh
              Patel's ₹30,000 scheduled transfer before 18-Nov.
            </span>
          </div>
        </div>
      </div>

      {/* ── 8 PRIMARY FINANCIAL KPI CARDS ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <StatCard
          title="Available Cash"
          value={formatINR(openingCashPaise.toString())}
          description="Liquid operating bank balances"
          badgeText="Verified"
          badgeVariant="emerald"
          icon={Wallet}
          onClick={() => onNavigate('payments')}
        />

        <StatCard
          title="Total Receivables"
          value={formatINR(totalReceivablesPaise.toString())}
          description={`${workspace.invoices.filter((i) => i.status === 'OPEN').length} active retailer invoices`}
          badgeText={`${overdueInvoices.length} Overdue`}
          badgeVariant="amber"
          icon={ArrowDownLeft}
          onClick={() => onNavigate('ledgers')}
        />

        <StatCard
          title="Total Payables"
          value={formatINR(totalPayablesPaise.toString())}
          description="Upcoming bills owed to suppliers"
          badgeText="Critical"
          badgeVariant="rose"
          icon={ArrowUpRight}
          onClick={() => onNavigate('ledgers')}
        />

        <StatCard
          title="Projected Cash Gap"
          value={isBreached ? formatINR(shortagePaise.toString()) : '₹0'}
          description={isBreached ? `Deficit on ${breach.firstBreachDate}` : 'Zero deficit projected'}
          badgeText={isBreached ? breach.firstBreachDate || 'Breach' : 'Safe'}
          badgeVariant={isBreached ? 'rose' : 'emerald'}
          variant={isBreached ? 'danger' : 'positive'}
          icon={TrendingDown}
          onClick={() => onNavigate('resolve')}
        />

        <StatCard
          title="Overdue Receivables"
          value={formatINR(overdueReceivablesPaise.toString())}
          description="Pending collections past due date"
          badgeText="Action Required"
          badgeVariant="amber"
          icon={AlertTriangle}
          onClick={() => onNavigate('communications')}
        />

        <StatCard
          title="Upcoming 7D Payables"
          value={formatINR(upcoming7dBillsPaise.toString())}
          description="Apex Consumer Goods due 18-Nov"
          badgeText="Fixed Due Date"
          badgeVariant="cyan"
          icon={Clock}
          onClick={() => onNavigate('ledgers')}
        />

        <StatCard
          title="Expected 7D Inflows"
          value={formatINR(expected7dInflowsPaise.toString())}
          description="Confirmed commitments from retailers"
          badgeText="High Reliability"
          badgeVariant="cyan"
          icon={Calendar}
          onClick={() => onNavigate('commitments')}
        />

        <StatCard
          title="Emergency Reserve"
          value="₹30,000"
          description="Target ₹1,00,000 buffer"
          badgeText="30% of Target"
          badgeVariant="indigo"
          icon={ShieldCheck}
          onClick={() => onNavigate('reserve')}
        />
      </div>

      {/* ── INTERACTIVE CASH-FLOW RECHARTS GRAPH ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          padding: '24px',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            paddingBottom: '16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 800,
                color: 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>Predictive Cash-Flow Horizon</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--primary)',
                  background: 'var(--primary-soft)',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  border: '1px solid var(--primary-border)',
                }}
              >
                Deterministic Forecast
              </span>
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Identifies projected cash shortages before they occur with exact supporting invoices and supplier bills.
            </p>
          </div>

          {/* Horizon Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-alt)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            {[7, 15, 30, 60].map((daysCount) => (
              <button
                key={daysCount}
                onClick={() => setChartHorizon(daysCount)}
                className={`btn btn-sm ${chartHorizon === daysCount ? 'btn-primary' : ''}`}
                style={{
                  padding: '4px 12px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: chartHorizon === daysCount ? 'none' : 'transparent',
                  background: chartHorizon === daysCount ? 'var(--primary)' : 'transparent',
                  color: chartHorizon === daysCount ? '#FFFFFF' : 'var(--text-muted)',
                }}
              >
                {daysCount}D
              </button>
            ))}
          </div>
        </div>

        {/* Recharts Area Graph */}
        <div style={{ height: 280, width: '100%', paddingTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="flowBalanceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="date" stroke="#64748B" fontSize={11} tickLine={false} />
              <YAxis
                stroke="#64748B"
                fontSize={11}
                tickLine={false}
                tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#CBD5E1',
                  borderRadius: '8px',
                  fontSize: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
                formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Projected Cash Balance']}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <ReferenceLine
                y={minThresholdRupees}
                stroke="#DC2626"
                strokeDasharray="4 4"
                label={{
                  value: `Min Threshold (₹${(minThresholdRupees / 1000).toFixed(0)}k)`,
                  fill: '#DC2626',
                  fontSize: 10,
                  position: 'insideTopLeft',
                }}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#2563EB"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#flowBalanceGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Explanation callout */}
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            borderRadius: '10px',
            background: isBreached ? '#FEF2F2' : '#F0FDF4',
            border: `1px solid ${isBreached ? '#FECACA' : '#BBF7D0'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isBreached ? '#DC2626' : '#16A34A',
                display: 'inline-block',
              }}
            />
            <span style={{ color: isBreached ? '#991B1B' : '#166534' }}>
              {isBreached ? (
                <>
                  Projected cash shortage of{' '}
                  <strong>{formatINR(shortagePaise.toString())}</strong> on{' '}
                  <strong>{breach.firstBreachDate}</strong> due to upcoming ₹1,50,000 Apex FMCG payment.
                </>
              ) : (
                'Safe liquidity trajectory: closing balance strictly exceeds threshold.'
              )}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onNavigate('what-if')}
              className="btn btn-sm"
              style={{ fontSize: '0.76rem', color: 'var(--primary)' }}
            >
              Test Scenarios in What-If <ChevronRight size={14} />
            </button>
            <button
              onClick={() => onNavigate('resolve')}
              className="btn btn-sm btn-primary"
              style={{ fontSize: '0.76rem' }}
            >
              Autopilot Resolution <Wand2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── PRIORITY ATTENTION CENTER & QUICK SHORTCUTS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* Priority Attention Center */}
        <div
          className="card"
          style={{
            background: 'var(--surface)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 12,
              borderBottom: '1px solid var(--border)',
              marginBottom: 14,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '0.9rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text)',
              }}
            >
              <AlertTriangle size={16} color="#F59E0B" /> Priority Attention Center
            </h3>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {overdueInvoices.length + 1} Flags Active
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Attention Item 1: Balaji Mart */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text)' }}>
                    Shree Balaji Mart
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#DC2626',
                      background: '#FEF2F2',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    14d Overdue
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  INV-2026-089: ₹80,000 pending. Recommended: collect ₹40,000 partial.
                </div>
              </div>
              <button
                onClick={() => onNavigate('communications')}
                className="btn btn-sm btn-primary"
                style={{ fontSize: '0.74rem', padding: '4px 10px' }}
              >
                Send WhatsApp
              </button>
            </div>

            {/* Attention Item 2: Apex Supplier Bill */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text)' }}>
                    Apex Consumer Goods Ltd
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#2563EB',
                      background: '#EFF6FF',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Due 18-Nov
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  BILL-APX-8821: ₹1,50,000 liability triggers projected gap.
                </div>
              </div>
              <button
                onClick={() => onNavigate('what-if')}
                className="btn btn-sm"
                style={{ fontSize: '0.74rem', padding: '4px 10px' }}
              >
                Model Deferral
              </button>
            </div>

            {/* Attention Item 3: Krishna Commitment Confirmation */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text)' }}>
                    Krishna Superstore
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#16A34A',
                      background: '#F0FDF4',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Commitment Due 17-Nov
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  ₹30,000 promised transfer. Suresh Patel confirmed via call.
                </div>
              </div>
              <button
                onClick={() => onNavigate('commitments')}
                className="btn btn-sm"
                style={{ fontSize: '0.74rem', padding: '4px 10px' }}
              >
                Track Status
              </button>
            </div>
          </div>
        </div>

        {/* Direct Action Hub & Navigation */}
        <div
          className="card"
          style={{
            background: 'var(--surface)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '20px',
          }}
        >
          <div
            style={{
              paddingBottom: 12,
              borderBottom: '1px solid var(--border)',
              marginBottom: 14,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '0.9rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text)',
              }}
            >
              Distributor Operational Hub
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Direct navigation to key financial ledgers and workflows.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              onClick={() => onNavigate('retailers')}
              className="btn"
              style={{
                justifyContent: 'flex-start',
                padding: '12px 14px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Users size={18} color="#2563EB" />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>Retailer Directory</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>13 active accounts</div>
              </div>
            </button>

            <button
              onClick={() => onNavigate('what-if')}
              className="btn"
              style={{
                justifyContent: 'flex-start',
                padding: '12px 14px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <SlidersHorizontal size={18} color="#7C3AED" />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>What-If Room</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Zero-risk sandbox</div>
              </div>
            </button>

            <button
              onClick={() => onNavigate('communications')}
              className="btn"
              style={{
                justifyContent: 'flex-start',
                padding: '12px 14px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <MessageSquare size={18} color="#16A34A" />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>WhatsApp Centre</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Live reminders & chat</div>
              </div>
            </button>

            <button
              onClick={() => onNavigate('payments')}
              className="btn"
              style={{
                justifyContent: 'flex-start',
                padding: '12px 14px',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <CreditCard size={18} color="#0EA5E9" />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>Reconcile & Match</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Bank SMS & allocations</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
