import React, { useState, useMemo } from 'react';
import {
  SlidersHorizontal,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  ShieldCheck,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import {
  computeCashForecast,
  formatINR,
  parsePaise,
  paiseToString,
  type CustomerInvoiceDTO,
  type OperatingExpenseDTO,
  type SupplierBillDTO,
  addDays,
} from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';

interface WhatIfControlRoomProps {
  workspace: WorkspacePayload;
  horizonDays?: number;
  onJumpToResolve?: () => void;
}

export const WhatIfControlRoom: React.FC<WhatIfControlRoomProps> = ({
  workspace,
  horizonDays = 30,
  onJumpToResolve,
}) => {
  const { business } = workspace;

  // Scenario Parameter State (in Rupees)
  const [balajiCollectionRupees, setBalajiCollectionRupees] = useState<number>(0);
  const [krishnaDelayDays, setKrishnaDelayDays] = useState<number>(0);
  const [apexShiftDays, setApexShiftDays] = useState<number>(0);
  const [reserveDrawRupees, setReserveDrawRupees] = useState<number>(0);
  const [expenseAdjustRupees, setExpenseAdjustRupees] = useState<number>(0);

  const minThresholdPaise = parsePaise(business.minimumCashPaise || '5000000');
  const minThresholdRupees = Number(minThresholdPaise) / 100;
  const openingCashPaise = parsePaise(business.openingCashPaise || '6000000');

  // Compute Baseline Forecast in-memory
  const baselineForecast = useMemo(() => {
    return computeCashForecast({
      businessId: business.id,
      asOfDate: business.openingCashDate,
      horizonDays,
      openingCashPaise: business.openingCashPaise,
      minimumCashPaise: business.minimumCashPaise,
      invoices: workspace.invoices,
      bills: workspace.bills,
      expenses: workspace.expenses,
    });
  }, [workspace, business, horizonDays]);

  // Compute Simulated Scenario Forecast purely in memory (NEVER mutates database!)
  const simulatedForecast = useMemo(() => {
    // 1. Clone invoices & apply simulated adjustments
    const simInvoices: CustomerInvoiceDTO[] = workspace.invoices.map((inv) => {
      // Krishna Superstore delay
      if (
        (inv.retailerCode === 'RET-02' || (inv.retailerName && inv.retailerName.toLowerCase().includes('krishna'))) &&
        krishnaDelayDays > 0
      ) {
        return {
          ...inv,
          dueDate: addDays(inv.dueDate, krishnaDelayDays),
        };
      }
      return { ...inv };
    });

    // If Balaji Mart partial collection simulated, add early inflow invoice or advance
    if (balajiCollectionRupees > 0) {
      const earlyDate = addDays(business.openingCashDate, 3); // 16-Nov
      simInvoices.push({
        id: 'sim-balaji-partial',
        businessId: business.id,
        retailerId: 'ret-balaji-sim',
        retailerCode: 'RET-01',
        retailerName: 'Shree Balaji Mart (Simulated Partial Payment)',
        invoiceNumber: 'SIM-BALAJI-01',
        invoiceDate: business.openingCashDate,
        dueDate: earlyDate,
        totalAmountPaise: paiseToString(BigInt(balajiCollectionRupees) * 100n),
        paidAmountPaise: '0',
        outstandingPaise: paiseToString(BigInt(balajiCollectionRupees) * 100n),
        status: 'OPEN',
        evidenceStatus: 'CONFIRMED_PROMISE',
        externalReference: 'SIM-EARLY-BALAJI',
        recordOrigin: 'MANUAL_ENTRY',
        notes: 'Simulated early collection from Shree Balaji Mart',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. Clone bills & apply simulated adjustments (Apex FMCG shift)
    const simBills: SupplierBillDTO[] = workspace.bills.map((bill) => {
      if (
        (bill.supplierCode === 'SUP-01' ||
          (bill.supplierName && bill.supplierName.toLowerCase().includes('apex')) ||
          bill.billNumber.includes('APX')) &&
        apexShiftDays > 0
      ) {
        return {
          ...bill,
          dueDate: addDays(bill.dueDate, apexShiftDays),
        };
      }
      return { ...bill };
    });

    // 3. Clone expenses & apply simulated adjustments
    const simExpenses: OperatingExpenseDTO[] = workspace.expenses.map((exp) => ({ ...exp }));
    if (expenseAdjustRupees !== 0) {
      simExpenses.push({
        id: 'sim-expense-adj',
        businessId: business.id,
        expenseCode: 'SIM-EXP',
        category: 'SIMULATED_ADJUSTMENT',
        description: 'Simulated Operating Expense Adjustment',
        dueDate: addDays(business.openingCashDate, 5),
        amountPaise: paiseToString(BigInt(Math.abs(expenseAdjustRupees)) * 100n),
        paidAmountPaise: '0',
        outstandingPaise: paiseToString(BigInt(Math.abs(expenseAdjustRupees)) * 100n),
        status: 'SCHEDULED',
        priorityTier: 'NORMAL',
        isProtected: false,
        recordOrigin: 'MANUAL_ENTRY',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 4. Adjust simulated opening cash if reserve draw is modeled
    const simOpeningCash = openingCashPaise + BigInt(reserveDrawRupees) * 100n;

    return computeCashForecast({
      businessId: business.id,
      asOfDate: business.openingCashDate,
      horizonDays,
      openingCashPaise: paiseToString(simOpeningCash),
      minimumCashPaise: business.minimumCashPaise,
      invoices: simInvoices,
      bills: simBills,
      expenses: simExpenses,
    });
  }, [
    workspace,
    business,
    horizonDays,
    balajiCollectionRupees,
    krishnaDelayDays,
    apexShiftDays,
    reserveDrawRupees,
    expenseAdjustRupees,
    openingCashPaise,
  ]);

  // Combined chart comparison series
  const chartData = baselineForecast.days.map((baseDay, idx) => {
    const simDay = simulatedForecast.days[idx] || baseDay;
    return {
      date: baseDay.date.slice(5),
      fullDate: baseDay.date,
      Baseline: Math.round(Number(parsePaise(baseDay.closingBalancePaise)) / 100),
      Simulated: Math.round(Number(parsePaise(simDay.closingBalancePaise)) / 100),
      Threshold: minThresholdRupees,
    };
  });

  const baselineShortagePaise = baselineForecast.breach.shortfallPaise
    ? parsePaise(baselineForecast.breach.shortfallPaise)
    : 0n;

  const simLowestBalancePaise = parsePaise(simulatedForecast.breach.lowestBalancePaise || '0');
  const isResolved = !simulatedForecast.breach.firstBreachDate;

  // Preset handlers
  const handleApplyPreset1 = () => {
    setBalajiCollectionRupees(40000); // Collect ₹40k early
    setKrishnaDelayDays(0);
    setApexShiftDays(0);
    setReserveDrawRupees(0);
    setExpenseAdjustRupees(0);
  };

  const handleApplyPreset2 = () => {
    setBalajiCollectionRupees(0);
    setKrishnaDelayDays(0);
    setApexShiftDays(7); // Defer Apex bill by 7 days
    setReserveDrawRupees(0);
    setExpenseAdjustRupees(0);
  };

  const handleApplyPreset3 = () => {
    setBalajiCollectionRupees(0);
    setKrishnaDelayDays(0);
    setApexShiftDays(0);
    setReserveDrawRupees(30000); // Draw ₹30k from reserve
    setExpenseAdjustRupees(0);
  };

  const handleReset = () => {
    setBalajiCollectionRupees(0);
    setKrishnaDelayDays(0);
    setApexShiftDays(0);
    setReserveDrawRupees(0);
    setExpenseAdjustRupees(0);
  };

  return (
    <div className="space-y-6" style={{ padding: '0 0 32px' }}>
      {/* ── HEADER & PRESETS ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              <SlidersHorizontal size={20} color="#7C3AED" />
              <span>What-If Financial Control Room</span>
            </h2>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                background: '#F5F3FF',
                color: '#7C3AED',
                border: '1px solid #DDD6FE',
                padding: '2px 8px',
                borderRadius: '12px',
              }}
            >
              Zero-Risk Sandbox
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Model alternative collection timings, retailer payment delays, and supplier payment restructuring without modifying underlying financial records.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleApplyPreset1}
            className="btn btn-sm"
            style={{ fontSize: '0.76rem', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            ⚡ Preset: Balaji Early Receipt
          </button>
          <button
            onClick={handleApplyPreset2}
            className="btn btn-sm"
            style={{ fontSize: '0.76rem', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            📅 Preset: Apex 7D Deferral
          </button>
          <button
            onClick={handleApplyPreset3}
            className="btn btn-sm"
            style={{ fontSize: '0.76rem', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            🛡️ Preset: Reserve Draw
          </button>
          <button
            onClick={handleReset}
            className="btn btn-sm btn-danger"
            style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>

      {/* ── SCENARIO STATUS BANNER ── */}
      <div
        style={{
          borderRadius: '16px',
          padding: '20px 24px',
          background: isResolved
            ? 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)'
            : 'linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)',
          border: `1px solid ${isResolved ? '#86EFAC' : '#FCA5A5'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              padding: '10px',
              borderRadius: '12px',
              background: isResolved ? '#22C55E' : '#EF4444',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isResolved ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 800,
                color: isResolved ? '#15803D' : '#B91C1C',
              }}
            >
              {isResolved
                ? 'Cash Deficit Successfully Resolved in Scenario!'
                : 'Scenario Still Breaches Minimum Threshold'}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: isResolved ? '#166534' : '#991B1B' }}>
              Baseline peak shortage was{' '}
              <strong>{formatINR(baselineShortagePaise.toString())}</strong> on{' '}
              {baselineForecast.breach.firstBreachDate || '18-Nov-2026'}.
              {isResolved
                ? ' Modeled adjustments keep closing cash strictly above minimum threshold.'
                : ' Adjust the sliders below to eliminate the remaining cash gap.'}
            </p>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: isResolved ? '#15803D' : '#B91C1C',
              letterSpacing: '0.5px',
              display: 'block',
            }}
          >
            Simulated Lowest Cash
          </span>
          <span
            style={{
              fontSize: '1.6rem',
              fontWeight: 800,
              fontFamily: 'monospace',
              color: isResolved ? '#15803D' : '#B91C1C',
            }}
          >
            {formatINR(simLowestBalancePaise.toString())}
          </span>
        </div>
      </div>

      {/* ── COMPARATIVE CASH FLOW CURVE (BASELINE VS SIMULATED) ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          padding: '24px',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 14,
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text)' }}>
              Comparative Cash Flow Curve (Baseline vs Simulated)
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Real-time projection comparing current commitments against sandbox parameters.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.78rem', fontFamily: 'monospace' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
              <span style={{ width: 14, height: 2, background: '#94A3B8', display: 'inline-block' }} /> Baseline
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2563EB', fontWeight: 700 }}>
              <span style={{ width: 14, height: 3, background: '#2563EB', display: 'inline-block' }} /> Simulated
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#DC2626' }}>
              <span style={{ width: 14, height: 1, borderTop: '2px dashed #DC2626', display: 'inline-block' }} /> Threshold
            </span>
          </div>
        </div>

        {/* Recharts Line Graph */}
        <div style={{ height: 280, width: '100%', paddingTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
                formatter={(val: any, name: any) => [`₹${Number(val).toLocaleString('en-IN')}`, name]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <ReferenceLine y={minThresholdRupees} stroke="#DC2626" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="Baseline"
                stroke="#94A3B8"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Simulated"
                stroke="#2563EB"
                strokeWidth={3}
                dot={{ r: 2, fill: '#2563EB' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── INTERACTIVE PARAMETER SLIDERS ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          padding: '24px',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text)' }}>
            Simulation Levers & Parameter Controls
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Drag sliders to simulate early collections, delayed payments, supplier deferrals, or reserve drawdowns in real-time.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          {/* Lever 1: Balaji Mart Early Collection */}
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                Shree Balaji Mart Partial Receipt
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: '#16A34A' }}>
                +₹{balajiCollectionRupees.toLocaleString('en-IN')}
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Overdue invoice INV-2026-089 (₹80,000 total). Model partial early collection before 18-Nov.
            </p>
            <input
              type="range"
              min={0}
              max={80000}
              step={5000}
              value={balajiCollectionRupees}
              onChange={(e) => setBalajiCollectionRupees(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#16A34A' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>₹0</span>
              <span>₹40,000 (Target)</span>
              <span>₹80,000 (Full)</span>
            </div>
          </div>

          {/* Lever 2: Apex Consumer Goods Supplier Deferral */}
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                Apex Consumer Goods Bill Shift
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: '#2563EB' }}>
                +{apexShiftDays} Days
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              BILL-APX-8821 (₹1,50,000 due 18-Nov). Defer outflow past the cash pinch.
            </p>
            <input
              type="range"
              min={0}
              max={15}
              step={1}
              value={apexShiftDays}
              onChange={(e) => setApexShiftDays(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#2563EB' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>0d (18-Nov)</span>
              <span>+7d (25-Nov)</span>
              <span>+15d (03-Dec)</span>
            </div>
          </div>

          {/* Lever 3: Krishna Superstore Payment Delay */}
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                Krishna Superstore Payment Delay
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: '#DC2626' }}>
                +{krishnaDelayDays} Days
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Stress test: simulate Suresh Patel delaying his promised ₹30,000 payment.
            </p>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={krishnaDelayDays}
              onChange={(e) => setKrishnaDelayDays(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#DC2626' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>0d (On Time)</span>
              <span>+10d</span>
              <span>+20d (Severe Delay)</span>
            </div>
          </div>

          {/* Lever 4: Emergency Reserve Drawdown */}
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                Emergency Reserve Drawdown
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: '#7C3AED' }}>
                +₹{reserveDrawRupees.toLocaleString('en-IN')}
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Draw protected buffer from Operating Emergency Reserve (₹30,000 available).
            </p>
            <input
              type="range"
              min={0}
              max={30000}
              step={5000}
              value={reserveDrawRupees}
              onChange={(e) => setReserveDrawRupees(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#7C3AED' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>₹0</span>
              <span>₹15,000</span>
              <span>₹30,000 (Full Reserve)</span>
            </div>
          </div>
        </div>

        {/* Footer info callout */}
        <div
          style={{
            marginTop: 20,
            padding: '12px 16px',
            borderRadius: '10px',
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={16} color="var(--primary)" />
            <span>
              All simulations execute strictly in local memory and evaluate against the shared deterministic forecasting engine. Actual ledgers and audit trails remain 100% pristine.
            </span>
          </div>
          {onJumpToResolve && (
            <button onClick={onJumpToResolve} className="btn btn-sm btn-primary" style={{ whiteSpace: 'nowrap' }}>
              Convert to Human Commitments →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
