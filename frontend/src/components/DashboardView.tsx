import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet,
  AlertTriangle,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Clock,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileCheck,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  SlidersHorizontal,
  Wand2,
  Users,
  AlertCircle,
  Building2,
  ExternalLink,
  MessageSquare,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from 'recharts';
import { formatINR, parsePaise } from '@flowbridge/shared';
import {
  api,
  type DashboardResponse,
  type CustomerInvoiceDTO,
  type SupplierBillDTO,
  type PaymentTransactionDTO,
} from '../api/client';
import { WhatsAppMessageModal, type WhatsAppTemplateType } from './WhatsAppMessageModal';

interface DashboardViewProps {
  dashboard: DashboardResponse;
  busy: boolean;
  onNavigate: (page: any) => void;
  onRefresh: () => void;
}

function daysAway(targetDateStr: string, asOfDateStr: string): string {
  const d1 = new Date(asOfDateStr);
  const d2 = new Date(targetDateStr);
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  return `Due in ${diffDays}d`;
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

  const [chartHorizon, setChartHorizon] = useState<number>(7);
  const [showDetailedLedger, setShowDetailedLedger] = useState<boolean>(false);
  const [reserveData, setReserveData] = useState<{ reserve: any; recentMovements: any[] } | null>(null);
  const [riskProfiles, setRiskProfiles] = useState<any[]>([]);
  const [loadingAsync, setLoadingAsync] = useState<boolean>(false);
  const [whatsAppModal, setWhatsAppModal] = useState<{
    isOpen: boolean;
    retailerId?: string;
    invoiceId?: string;
    templateType?: WhatsAppTemplateType;
  }>({ isOpen: false });

  useEffect(() => {
    let isMounted = true;
    setLoadingAsync(true);

    Promise.all([
      api.getReserveStatus(business.id).catch(() => null),
      api.getRetailerRiskProfiles(business.id).catch(() => []),
    ]).then(([resData, profiles]) => {
      if (isMounted) {
        if (resData) setReserveData(resData);
        if (Array.isArray(profiles)) setRiskProfiles(profiles);
        setLoadingAsync(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [business.id]);

  // ── LEVEL 1: IMMEDIATE FINANCIAL OVERVIEW CALCULATIONS ──────────────
  const openingCashPaise = parsePaise(business.openingCashPaise || '0');
  const minThresholdPaise = parsePaise(business.minimumCashPaise || '0');
  const hasOpeningCashConfigured = Boolean(business.openingCashPaise && business.openingCashPaise !== '0');
  const minThresholdRupees = Number(minThresholdPaise) / 100;

  // Buffer above minimum threshold
  const cashBufferPaise = openingCashPaise - minThresholdPaise;
  const isAboveThreshold = cashBufferPaise >= 0n;

  // Invoices & Receivables
  const openInvoices = useMemo(
    () => workspace.invoices.filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE' || i.status === 'PARTIALLY_PAID'),
    [workspace.invoices],
  );

  const totalReceivablesPaise = useMemo(
    () => openInvoices.reduce((sum, inv) => sum + parsePaise(inv.outstandingPaise || '0'), 0n),
    [openInvoices],
  );

  const overdueInvoices = useMemo(
    () =>
      openInvoices.filter(
        (inv) => inv.status === 'OVERDUE' || (inv.status === 'OPEN' && inv.dueDate < business.openingCashDate),
      ),
    [openInvoices, business.openingCashDate],
  );

  const overdueReceivablesPaise = useMemo(
    () => overdueInvoices.reduce((sum, inv) => sum + parsePaise(inv.outstandingPaise || '0'), 0n),
    [overdueInvoices],
  );

  // Payables & Obligations
  const openBills = useMemo(
    () => workspace.bills.filter((b) => b.status === 'OPEN' || b.status === 'PARTIALLY_PAID' || b.status === 'DEFERRED'),
    [workspace.bills],
  );

  const openExpenses = useMemo(
    () => workspace.expenses.filter((e) => e.status === 'SCHEDULED' || e.status === 'DEFERRED'),
    [workspace.expenses],
  );

  // Next Upcoming Obligation (earliest upcoming bill or expense)
  const nextObligation = useMemo(() => {
    const upcomingItems: Array<{ name: string; dueDate: string; amountPaise: bigint; type: 'BILL' | 'EXPENSE' }> = [];

    for (const b of openBills) {
      if (b.dueDate >= business.openingCashDate) {
        const sup = workspace.suppliers.find((s) => s.id === b.supplierId);
        upcomingItems.push({
          name: sup ? sup.name : `Bill ${b.billNumber}`,
          dueDate: b.dueDate,
          amountPaise: parsePaise(b.outstandingPaise || '0'),
          type: 'BILL',
        });
      }
    }

    for (const e of openExpenses) {
      if (e.dueDate >= business.openingCashDate) {
        upcomingItems.push({
          name: e.category ? e.category.replace(/_/g, ' ') : (e.description || 'Operating Expense'),
          dueDate: e.dueDate,
          amountPaise: parsePaise(e.outstandingPaise || '0'),
          type: 'EXPENSE',
        });
      }
    }

    upcomingItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return upcomingItems[0] || null;
  }, [openBills, openExpenses, workspace.suppliers, business.openingCashDate]);

  // 7-Day Window Calculations
  const horizon7Date = useMemo(() => {
    const d = new Date(business.openingCashDate);
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, [business.openingCashDate]);

  const expected7dInflowsPaise = useMemo(() => {
    return workspace.invoices
      .filter((i) => (i.status === 'OPEN' || i.status === 'OVERDUE') && i.dueDate <= horizon7Date && i.dueDate >= business.openingCashDate)
      .reduce((sum, i) => sum + parsePaise(i.outstandingPaise || '0'), 0n);
  }, [workspace.invoices, horizon7Date, business.openingCashDate]);

  const upcoming7dBillsPaise = useMemo(() => {
    return workspace.bills
      .filter((b) => (b.status === 'OPEN' || b.status === 'PARTIALLY_PAID' || b.status === 'DEFERRED') && b.dueDate <= horizon7Date && b.dueDate >= business.openingCashDate)
      .reduce((sum, b) => sum + parsePaise(b.outstandingPaise || '0'), 0n);
  }, [workspace.bills, horizon7Date, business.openingCashDate]);

  const upcoming7dExpensesPaise = useMemo(() => {
    return workspace.expenses
      .filter((e) => (e.status === 'SCHEDULED' || e.status === 'DEFERRED') && e.dueDate <= horizon7Date && e.dueDate >= business.openingCashDate)
      .reduce((sum, e) => sum + parsePaise(e.outstandingPaise || '0'), 0n);
  }, [workspace.expenses, horizon7Date, business.openingCashDate]);

  const upcoming7dOutflowsPaise = upcoming7dBillsPaise + upcoming7dExpensesPaise;
  const net7dCashMovementPaise = expected7dInflowsPaise - upcoming7dOutflowsPaise;

  // Emergency Reserve Status
  const reserve = reserveData?.reserve;
  const currentReservePaise = reserve?.currentReservePaise ? parsePaise(reserve.currentReservePaise) : 0n;
  const targetReservePaise = reserve?.targetReservePaise ? parsePaise(reserve.targetReservePaise) : 0n;
  const reserveFundedPct =
    targetReservePaise > 0n ? Math.min(100, Math.round(Number((currentReservePaise * 100n) / targetReservePaise))) : 0;

  // Projected Cash Gap / Deficit
  const isBreached = Boolean(breach.firstBreachDate);
  const shortagePaise = breach.shortfallPaise ? parsePaise(breach.shortfallPaise) : 0n;
  const daysUntilBreach = breach.firstBreachDate ? daysAway(breach.firstBreachDate, business.openingCashDate) : null;

  // ── LEVEL 3: BUSINESS SIGNALS CALCULATIONS ──────────────────────────
  // 1. Retailers predicted to delay
  const delayedRetailers = useMemo(() => {
    return riskProfiles.filter(
      (p) =>
        p.riskCategory === 'HIGH_RISK' ||
        p.riskCategory === 'AT_RISK' ||
        (p.modelPrediction?.status === 'EVALUATED' && p.modelPrediction.predictedDelayDays > 4) ||
        (p.historicalStats?.averageDelayDays !== null && p.historicalStats.averageDelayDays > 7),
    );
  }, [riskProfiles]);

  const delayedRetailersExposurePaise = useMemo(() => {
    return delayedRetailers.reduce((sum, r) => sum + parsePaise(r.totalOutstandingPaise || '0'), 0n);
  }, [delayedRetailers]);

  // 2. Retailers with overdue invoices
  const retailersWithOverdue = useMemo(() => {
    const overdueSet = new Set(overdueInvoices.map((i) => i.retailerId));
    return overdueSet.size;
  }, [overdueInvoices]);

  // 3. Retailers exceeding credit limit
  const retailersOverLimit = useMemo(() => {
    return riskProfiles.filter(
      (p) => p.historicalStats?.creditLimitUtilisationPct !== null && p.historicalStats.creditLimitUtilisationPct > 100,
    );
  }, [riskProfiles]);

  // 4. Broken commitments
  const brokenCommitments = useMemo(() => {
    return workspace.commitments.filter((c) => c.status === 'FAILED');
  }, [workspace.commitments]);

  const brokenCommitmentsPaise = useMemo(() => {
    return brokenCommitments.reduce(
      (sum, c) => sum + (c.agreedAmountPaise ? parsePaise(c.agreedAmountPaise) : parsePaise(c.proposedAmountPaise || '0')),
      0n,
    );
  }, [brokenCommitments]);

  // 5. Payments awaiting verification
  const unverifiedPayments = useMemo(() => {
    return workspace.transactions.filter(
      (t) => t.direction === 'INFLOW' && t.verificationStatus === 'PENDING_REVIEW' && !t.isReversed,
    );
  }, [workspace.transactions]);

  const unverifiedTotalPaise = useMemo(
    () => unverifiedPayments.reduce((sum, t) => sum + parsePaise(t.amountPaise), 0n),
    [unverifiedPayments],
  );

  // 6. Unmatched & ambiguous transactions
  const unmatchedTransactions = useMemo(() => {
    return workspace.transactions.filter(
      (t) =>
        t.direction === 'INFLOW' &&
        (t.matchStatus === 'UNMATCHED' || t.matchStatus === 'AMBIGUOUS') &&
        !t.isReversed,
    );
  }, [workspace.transactions]);

  const unmatchedTotalPaise = useMemo(
    () => unmatchedTransactions.reduce((sum, t) => sum + parsePaise(t.amountPaise), 0n),
    [unmatchedTransactions],
  );

  // 7. Upcoming supplier payments (count in 7d)
  const upcomingBills7d = useMemo(() => {
    return openBills.filter((b) => b.dueDate <= horizon7Date && b.dueDate >= business.openingCashDate);
  }, [openBills, horizon7Date, business.openingCashDate]);

  // 8. Today's genuine collection progress
  const todayTarget = useMemo(() => {
    const todayInvoices = workspace.invoices.filter((i) => i.dueDate === business.openingCashDate && i.status !== 'CANCELLED');
    if (todayInvoices.length === 0) return null;

    const totalTarget = todayInvoices.reduce((sum, i) => sum + parsePaise(i.totalAmountPaise), 0n);
    const totalCollected = todayInvoices.reduce((sum, i) => sum + parsePaise(i.paidAmountPaise), 0n);
    const pct = totalTarget > 0n ? Math.min(100, Math.round(Number((totalCollected * 100n) / totalTarget))) : 0;

    return {
      count: todayInvoices.length,
      targetPaise: totalTarget,
      collectedPaise: totalCollected,
      percentage: pct,
    };
  }, [workspace.invoices, business.openingCashDate]);

  // 9. Recent verified payments
  const recentVerifiedPayments = useMemo(() => {
    return [...workspace.transactions]
      .filter((t) => t.direction === 'INFLOW' && t.verificationStatus === 'VERIFIED' && !t.isReversed)
      .sort((a, b) => b.valueDate.localeCompare(a.valueDate) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 4);
  }, [workspace.transactions]);

  const recentVerifiedTotalPaise = useMemo(() => {
    return recentVerifiedPayments.reduce((sum, t) => sum + parsePaise(t.amountPaise), 0n);
  }, [recentVerifiedPayments]);

  // ── LEVEL 4: PRIORITISED ACTIONS ────────────────────────────────────
  const prioritizedActions = useMemo(() => {
    const list: Array<{
      id: string;
      urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
      title: string;
      reason: string;
      amountPaise?: bigint;
      actionText: string;
      targetPage: string;
      whatsAppAction?: {
        retailerId?: string;
        templateType: WhatsAppTemplateType;
      };
    }> = [];

    // Action 1: Cash Gap / Projected Shortage
    if (isBreached && breach.firstBreachDate) {
      list.push({
        id: 'action-breach',
        urgency: 'CRITICAL',
        title: `Projected Cash Shortage of ${formatINR(shortagePaise.toString())} on ${breach.firstBreachDate}`,
        reason: 'Operating cash buffer will drop below minimum threshold. Supplier obligations require early receipts or structured deferrals.',
        amountPaise: shortagePaise,
        actionText: 'Execute Resolution Autopilot',
        targetPage: 'resolve',
      });
    }

    // Action 2: Unmatched Bank Payments
    if (unmatchedTransactions.length > 0) {
      list.push({
        id: 'action-unmatched',
        urgency: 'HIGH',
        title: `${unmatchedTransactions.length} Unmatched Deposit${unmatchedTransactions.length > 1 ? 's' : ''} (${formatINR(unmatchedTotalPaise.toString())})`,
        reason: 'Incoming payments from bank statements have no verified counterparty match. Resolving updates outstanding credit immediately.',
        amountPaise: unmatchedTotalPaise,
        actionText: 'Reconcile Transactions',
        targetPage: 'payments',
      });
    }

    // Action 3: Retailer Predicted Payment Delay
    if (delayedRetailers.length > 0) {
      const topRisk = delayedRetailers[0];
      const isHold = topRisk.creditHoldDetails?.isUnderCreditHold;
      list.push({
        id: 'action-delay-risk',
        urgency: isHold ? 'CRITICAL' : 'HIGH',
        title: `Follow up with ${topRisk.retailerName} (${formatINR(topRisk.totalOutstandingPaise)})`,
        reason: isHold
          ? 'Authorised credit hold active due to severe payment delays. Restrict new credit orders until past-due debt is settled.'
          : `XGBoost prediction indicates payment delay risk (+${topRisk.modelPrediction?.predictedDelayDays ?? 4} days). Prioritise collection dialogue.`,
        amountPaise: parsePaise(topRisk.totalOutstandingPaise || '0'),
        actionText: 'Inspect Retailer Risk Profile',
        targetPage: 'risk',
        whatsAppAction: {
          retailerId: topRisk.retailerId,
          templateType: 'OVERDUE_REMINDER',
        },
      });
    }

    // Action 4: Broken Payment Commitments
    if (brokenCommitments.length > 0) {
      list.push({
        id: 'action-broken-commitment',
        urgency: 'HIGH',
        title: `${brokenCommitments.length} Broken Payment Promise${brokenCommitments.length > 1 ? 's' : ''}`,
        reason: 'Retailer promised payment schedule was not fulfilled by agreed value date. Renegotiate or escalate.',
        amountPaise: brokenCommitmentsPaise,
        actionText: 'Review Commitments',
        targetPage: 'commitments',
        whatsAppAction: {
          retailerId: brokenCommitments[0]?.retailerId || undefined,
          templateType: 'COMMITMENT_FOLLOWUP',
        },
      });
    }

    // Action 5: Overdue Receivables
    if (overdueInvoices.length > 0) {
      list.push({
        id: 'action-overdue-invoices',
        urgency: 'MEDIUM',
        title: `${overdueInvoices.length} Overdue Retailer Invoice${overdueInvoices.length > 1 ? 's' : ''} (${formatINR(overdueReceivablesPaise.toString())})`,
        reason: 'Receivables past contracted payment terms. Issue structured settlement notices.',
        amountPaise: overdueReceivablesPaise,
        actionText: 'View Overdue Ledgers',
        targetPage: 'ledgers',
        whatsAppAction: {
          retailerId: overdueInvoices[0]?.retailerId,
          templateType: 'OVERDUE_REMINDER',
        },
      });
    }

    // Sort: CRITICAL > HIGH > MEDIUM
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    list.sort((a, b) => order[a.urgency] - order[b.urgency]);
    return list.slice(0, 4);
  }, [
    isBreached,
    breach.firstBreachDate,
    shortagePaise,
    unmatchedTransactions.length,
    unmatchedTotalPaise,
    delayedRetailers,
    brokenCommitments.length,
    brokenCommitmentsPaise,
    overdueInvoices.length,
    overdueReceivablesPaise,
  ]);

  // ── LEVEL 4: SUPPORTING INFORMATION (TOP RETAILERS & CHART) ─────────
  const topRetailers = useMemo(() => {
    const map = new Map<string, { retailer: any; outstandingPaise: bigint; overdueCount: number }>();

    for (const inv of openInvoices) {
      const ret = workspace.retailers.find((r) => r.id === inv.retailerId);
      if (!ret) continue;
      if (!map.has(ret.id)) {
        map.set(ret.id, { retailer: ret, outstandingPaise: 0n, overdueCount: 0 });
      }
      const entry = map.get(ret.id)!;
      entry.outstandingPaise += parsePaise(inv.outstandingPaise || '0');
      if (inv.status === 'OVERDUE' || (inv.status === 'OPEN' && inv.dueDate < business.openingCashDate)) {
        entry.overdueCount += 1;
      }
    }

    return Array.from(map.values())
      .sort((a, b) => (b.outstandingPaise > a.outstandingPaise ? 1 : -1))
      .slice(0, 5);
  }, [openInvoices, workspace.retailers, business.openingCashDate]);

  // Chart data: Distinguish actual cash, expected receipts, expected payments, forecasted balance
  const chartData = useMemo(() => {
    return days.slice(0, chartHorizon).map((d) => {
      const closingRupees = Math.round(Number(parsePaise(d.closingBalancePaise)) / 100);
      const inflowRupees = Math.round(Number(parsePaise(d.totalInflowsPaise || '0')) / 100);
      const outflowRupees = Math.round(Number(parsePaise(d.totalOutflowsPaise || '0')) / 100);

      return {
        date: d.date.slice(5),
        fullDate: d.date,
        dayLabel: `Day ${d.dayIndex + 1}`,
        inflow: inflowRupees,
        outflow: outflowRupees,
        forecastBalance: closingRupees,
        threshold: minThresholdRupees,
      };
    });
  }, [days, chartHorizon, minThresholdRupees]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 40 }}>
      {/* ── COMMAND CENTRE HEADER ──────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '14px 20px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>
                Financial Operations Command Centre
              </h1>
              <span className="code-pill">
                {business.code} · {business.name}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Verified ledger balances, liquidity runway & operational counterparty signals
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Freshness Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              background: 'var(--surface-alt)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <FileCheck size={14} color="#15803D" />
            <span>As of: <strong>{business.openingCashDate}</strong></span>
          </div>

          {/* Quick Sandbox / Resolve buttons */}
          <button
            className="btn btn-sm"
            onClick={() => onNavigate('what-if')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}
          >
            <SlidersHorizontal size={14} /> What-If Sandbox
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => onNavigate('resolve')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}
          >
            <Wand2 size={14} /> Resolution Autopilot
          </button>
          <button
            className="btn btn-sm"
            onClick={onRefresh}
            disabled={busy}
            title="Refresh verified ledgers"
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px' }}
          >
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── LEVEL 1: IMMEDIATE FINANCIAL OVERVIEW ────────────────────── */}
      <section aria-label="Level 1 Immediate Financial Overview">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            Level 1 — Instant Financial Overview
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-light)' }}>
            All metrics calculated from verified double-entry ledgers
          </div>
        </div>

        {/* Primary Hero Card + Compact Metrics Split */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 340px) 1fr',
            gap: 14,
            marginBottom: 12,
          }}
        >
          {/* HERO CARD: Available Operating Cash (Primary Figure) */}
          <div
            className="card"
            style={{
              padding: '20px 22px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Available Operating Cash
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: isAboveThreshold ? 'var(--green-soft)' : 'var(--rose-soft)',
                    color: isAboveThreshold ? 'var(--green)' : 'var(--rose)',
                    border: `1px solid ${isAboveThreshold ? 'var(--green-border)' : 'var(--rose-border)'}`,
                  }}
                >
                  <ShieldCheck size={12} /> Verified
                </span>
              </div>

              {hasOpeningCashConfigured ? (
                <div style={{ fontSize: '2.1rem', fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.8px', lineHeight: 1.1 }}>
                  {formatINR(openingCashPaise.toString())}
                </div>
              ) : (
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--amber)' }}>
                  Not Configured
                </div>
              )}

              <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {hasOpeningCashConfigured ? (
                  isAboveThreshold ? (
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                      +{formatINR(cashBufferPaise.toString())} above minimum threshold ({formatINR(minThresholdPaise.toString())})
                    </span>
                  ) : (
                    <span style={{ color: 'var(--rose)', fontWeight: 600 }}>
                      -{formatINR((-cashBufferPaise).toString())} below minimum threshold ({formatINR(minThresholdPaise.toString())})
                    </span>
                  )
                ) : (
                  <span style={{ color: 'var(--amber)' }}>Set verified opening cash in Business Settings</span>
                )}
              </div>
            </div>

            {/* Quick Status Pill */}
            <div
              style={{
                marginTop: 16,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                background: isBreached ? 'var(--rose-soft)' : 'var(--surface-alt)',
                border: `1px solid ${isBreached ? 'var(--rose-border)' : 'var(--border)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '0.76rem', fontWeight: 700, color: isBreached ? 'var(--rose)' : 'var(--green)' }}>
                {isBreached ? `Cash Gap in ${daysUntilBreach}` : 'Liquidity Trajectory Safe'}
              </span>
              <button
                className="btn btn-sm"
                onClick={() => onNavigate(isBreached ? 'resolve' : 'forecast')}
                style={{ fontSize: '0.74rem', padding: '2px 8px' }}
              >
                {isBreached ? 'Resolve Gap →' : 'View Runway →'}
              </button>
            </div>
          </div>

          {/* 5 COMPACT SUPPORTING METRICS ALIGNED IN A GRID */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            {/* Metric 1: Projected Cash Runway / Gap */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                background: isBreached ? 'var(--rose-soft)' : 'var(--surface)',
                border: `1px solid ${isBreached ? 'var(--rose-border)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => onNavigate(isBreached ? 'resolve' : 'forecast')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: isBreached ? '#991B1B' : 'var(--text-muted)' }}>
                  Cash Gap Projection
                </span>
                <TrendingDown size={16} color={isBreached ? '#DC2626' : '#15803D'} />
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: isBreached ? '#DC2626' : 'var(--text)', margin: '6px 0 2px' }}>
                {isBreached ? formatINR(shortagePaise.toString()) : '₹0 Deficit'}
              </div>
              <div style={{ fontSize: '0.72rem', color: isBreached ? '#B91C1C' : 'var(--green)', fontWeight: 600 }}>
                {isBreached ? `Shortfall on ${breach.firstBreachDate}` : `${forecast.horizonDays}-day runway positive`}
              </div>
            </div>

            {/* Metric 2: Next Upcoming Obligation */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => onNavigate('ledgers')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>Next Due Obligation</span>
                <Clock size={16} color="var(--terracotta)" />
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', margin: '6px 0 2px' }}>
                {nextObligation ? formatINR(nextObligation.amountPaise.toString()) : 'None'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nextObligation ? `${nextObligation.name} (${daysAway(nextObligation.dueDate, business.openingCashDate)})` : 'No open bills due'}
              </div>
            </div>

            {/* Metric 3: Total Outstanding Receivables */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => onNavigate('ledgers')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>Total Receivables</span>
                <ArrowDownLeft size={16} color="#0D9488" />
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', margin: '6px 0 2px' }}>
                {formatINR(totalReceivablesPaise.toString())}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Across {openInvoices.length} active customer invoice{openInvoices.length === 1 ? '' : 's'}
              </div>
            </div>

            {/* Metric 4: Overdue Receivables */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                background: overdueInvoices.length > 0 ? 'var(--amber-soft)' : 'var(--surface)',
                border: `1px solid ${overdueInvoices.length > 0 ? 'var(--amber-border)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => onNavigate('communications')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: overdueInvoices.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
                  Overdue Receivables
                </span>
                <AlertTriangle size={16} color={overdueInvoices.length > 0 ? 'var(--amber)' : '#9CA3AF'} />
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: overdueInvoices.length > 0 ? '#B45309' : 'var(--text)', margin: '6px 0 2px' }}>
                {formatINR(overdueReceivablesPaise.toString())}
              </div>
              <div style={{ fontSize: '0.72rem', color: overdueInvoices.length > 0 ? '#B45309' : 'var(--text-muted)', fontWeight: 600 }}>
                {overdueInvoices.length > 0 ? `${overdueInvoices.length} past-due invoices require collection` : 'Zero overdue invoices'}
              </div>
            </div>

            {/* Metric 5: Emergency Reserve */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => onNavigate('reserve')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>Emergency Reserve</span>
                <ShieldCheck size={16} color="var(--primary)" />
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', margin: '6px 0 2px' }}>
                {formatINR(currentReservePaise.toString())}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {targetReservePaise > 0n ? `${reserveFundedPct}% of ${formatINR(targetReservePaise.toString())} target funded` : 'Active liquidity reserve'}
              </div>
            </div>
          </div>
        </div>

        {/* Level 1 Sub-Ribbon: 7-Day Net Cash Flow Movement */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            padding: '10px 18px',
            background: 'var(--surface-alt)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span>
              Expected Collections (7d):{' '}
              <strong style={{ color: 'var(--green)' }}>+{formatINR(expected7dInflowsPaise.toString())}</strong>
            </span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <span>
              Upcoming Obligations (7d):{' '}
              <strong style={{ color: 'var(--terracotta)' }}>-{formatINR(upcoming7dOutflowsPaise.toString())}</strong>
            </span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <span>
              Net Expected Movement:{' '}
              <strong style={{ color: net7dCashMovementPaise >= 0n ? 'var(--green)' : 'var(--rose)' }}>
                {net7dCashMovementPaise >= 0n ? '+' : ''}
                {formatINR(net7dCashMovementPaise.toString())}
              </strong>
            </span>
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-light)' }}>
            Collections scheduled through {horizon7Date}
          </span>
        </div>
      </section>

      {/* ── LEVEL 2: FINANCIAL HEALTH & CASH-FLOW OUTLOOK ──────────── */}
      <section aria-label="Level 2 Financial Health and Cash-Flow Outlook">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            Level 2 — Financial Health & Cash-Flow Outlook
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[7, 15, 30].map((h) => (
              <button
                key={h}
                className={`btn btn-sm ${chartHorizon === h ? 'btn-primary' : ''}`}
                style={{ padding: '2px 8px', fontSize: '0.74rem' }}
                onClick={() => setChartHorizon(h)}
              >
                {h} Days
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(300px, 360px) 1fr',
            gap: 14,
          }}
        >
          {/* Health & Diagnostic Panel */}
          <div
            className="card"
            style={{
              padding: '18px 20px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Liquidity Diagnostic
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: isBreached ? 'var(--rose-soft)' : 'var(--green-soft)',
                    color: isBreached ? 'var(--rose)' : 'var(--green)',
                    border: `1px solid ${isBreached ? 'var(--rose-border)' : 'var(--green-border)'}`,
                  }}
                >
                  {isBreached ? 'DEFICIT PROJECTED' : 'HEALTHY TRAJECTORY'}
                </span>
              </div>

              {/* Cash-flow shortage status */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                  {isBreached ? (
                    <span style={{ color: 'var(--rose)' }}>
                      Cash Shortage Expected on {breach.firstBreachDate}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--green)' }}>
                      Zero Cash Shortages across {chartHorizon}-day horizon
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {isBreached
                    ? `Projected deficit of ${formatINR(shortagePaise.toString())}. Obligations exceed available operating cash buffer.`
                    : `Operating cash remains comfortably above the minimum threshold (${formatINR(minThresholdPaise.toString())}).`}
                </div>
              </div>

              {/* Coverage analysis */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  7-Day Coverage Ratio
                </div>
                <div style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                  {upcoming7dOutflowsPaise > 0n
                    ? `${Math.round(Number((expected7dInflowsPaise * 100n) / upcoming7dOutflowsPaise))}% Coverage`
                    : '100% (Zero Outflows Scheduled)'}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {expected7dInflowsPaise >= upcoming7dOutflowsPaise
                    ? 'Expected collections fully cover upcoming supplier bills and expenses.'
                    : 'Expected collections alone are insufficient to cover upcoming obligations without operating buffer.'}
                </div>
              </div>

              {/* Reserve Cushion */}
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                <strong>Reserve Readiness:</strong> {formatINR(currentReservePaise.toString())} in emergency reserves is liquid and available to buffer shortages without commercial borrowing.
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onNavigate(isBreached ? 'resolve' : 'forecast')}
                style={{ width: '100%', fontSize: '0.82rem', padding: '8px 0' }}
              >
                {isBreached ? 'Resolve Projected Shortage' : 'Inspect Full Forecast Timeline'}
              </button>
            </div>
          </div>

          {/* 7-Day Cash-Flow Chart */}
          <div
            className="card"
            style={{
              padding: '16px 20px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text)' }}>
                  Cash-Flow Projection & Scheduled Movements
                </span>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                  Baseline Cash: {formatINR(openingCashPaise.toString())} · Min Threshold: {formatINR(minThresholdPaise.toString())}
                </div>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Horizon: {chartHorizon} Days
              </div>
            </div>

            <div style={{ height: 210, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div
                          style={{
                            background: '#FFFFFF',
                            border: '1px solid var(--border)',
                            padding: '8px 12px',
                            borderRadius: 6,
                            boxShadow: 'var(--shadow-md)',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div style={{ fontWeight: 800, marginBottom: 4 }}>{data.fullDate}</div>
                          <div style={{ color: 'var(--text)' }}>
                            Forecasted Closing: <strong>₹{data.forecastBalance.toLocaleString('en-IN')}</strong>
                          </div>
                          <div style={{ color: 'var(--green)' }}>
                            Expected Inflow: +₹{data.inflow.toLocaleString('en-IN')}
                          </div>
                          <div style={{ color: 'var(--terracotta)' }}>
                            Scheduled Outflow: -₹{data.outflow.toLocaleString('en-IN')}
                          </div>
                          <div style={{ color: 'var(--amber)', fontSize: '0.72rem', marginTop: 4 }}>
                            Floor: ₹{data.threshold.toLocaleString('en-IN')}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    y={minThresholdRupees}
                    stroke="var(--amber)"
                    strokeDasharray="4 4"
                    label={{ value: 'Floor', position: 'right', fill: 'var(--amber)', fontSize: 10 }}
                  />
                  <Bar dataKey="inflow" name="Expected Receipts" fill="var(--green)" opacity={0.65} barSize={12} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outflow" name="Scheduled Payments" fill="var(--terracotta)" opacity={0.65} barSize={12} radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="forecastBalance"
                    name="Forecasted Balance"
                    stroke="var(--text)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: 'var(--text)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '0.74rem', paddingTop: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 4, textAlign: 'center' }}>
              * Forecasted balance accounts for scheduled collections and obligations. Expected receipts are not available cash until verified.
            </div>
          </div>
        </div>
      </section>

      {/* ── LEVEL 3: BUSINESS RISK & OPERATIONAL SIGNALS ───────────── */}
      <section aria-label="Level 3 Business Risk and Operational Signals">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            Level 3 — Business Risk & Operational Signals
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-light)' }}>
            High-priority operational exceptions requiring action
          </span>
        </div>

        {/* 8 Compact Signal Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          {/* Signal 1: Retailers Predicted to Delay */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: delayedRetailers.length > 0 ? 'var(--amber-soft)' : 'var(--surface)',
              border: `1px solid ${delayedRetailers.length > 0 ? 'var(--amber-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('risk')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: delayedRetailers.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
                Payment Delay Predicted
              </span>
              <AlertTriangle size={15} color={delayedRetailers.length > 0 ? 'var(--amber)' : '#9CA3AF'} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: delayedRetailers.length > 0 ? '#B45309' : 'var(--text)', margin: '4px 0 2px' }}>
              {delayedRetailers.length} Retailer{delayedRetailers.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: delayedRetailers.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
              {delayedRetailers.length > 0 ? `${formatINR(delayedRetailersExposurePaise.toString())} at risk (XGBoost)` : 'Zero delay risk flagged'}
            </div>
          </div>

          {/* Signal 2: Retailers with Overdue Invoices */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: overdueInvoices.length > 0 ? 'var(--rose-soft)' : 'var(--surface)',
              border: `1px solid ${overdueInvoices.length > 0 ? 'var(--rose-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('ledgers')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: overdueInvoices.length > 0 ? 'var(--rose)' : 'var(--text-muted)' }}>
                Retailers Overdue
              </span>
              <AlertCircle size={15} color={overdueInvoices.length > 0 ? 'var(--rose)' : '#9CA3AF'} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: overdueInvoices.length > 0 ? 'var(--rose)' : 'var(--text)', margin: '4px 0 2px' }}>
              {retailersWithOverdue} Retailer{retailersWithOverdue === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: overdueInvoices.length > 0 ? 'var(--rose)' : 'var(--text-muted)' }}>
              {overdueInvoices.length > 0 ? `${overdueInvoices.length} invoices · ${formatINR(overdueReceivablesPaise.toString())}` : 'Zero overdue invoices'}
            </div>
          </div>

          {/* Signal 3: Retailers Exceeding Credit Limits */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: retailersOverLimit.length > 0 ? 'var(--amber-soft)' : 'var(--surface)',
              border: `1px solid ${retailersOverLimit.length > 0 ? 'var(--amber-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('agreements')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: retailersOverLimit.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
                Credit Limit Breaches
              </span>
              <Building2 size={15} color={retailersOverLimit.length > 0 ? 'var(--amber)' : '#9CA3AF'} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: retailersOverLimit.length > 0 ? '#B45309' : 'var(--text)', margin: '4px 0 2px' }}>
              {retailersOverLimit.length} Retailer{retailersOverLimit.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: retailersOverLimit.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
              {retailersOverLimit.length > 0 ? 'Outstanding exceeds active credit agreement' : 'All within agreed credit limits'}
            </div>
          </div>

          {/* Signal 4: Broken Payment Commitments */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: brokenCommitments.length > 0 ? 'var(--rose-soft)' : 'var(--surface)',
              border: `1px solid ${brokenCommitments.length > 0 ? 'var(--rose-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('commitments')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: brokenCommitments.length > 0 ? 'var(--rose)' : 'var(--text-muted)' }}>
                Broken Commitments
              </span>
              <AlertTriangle size={15} color={brokenCommitments.length > 0 ? 'var(--rose)' : '#9CA3AF'} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: brokenCommitments.length > 0 ? 'var(--rose)' : 'var(--text)', margin: '4px 0 2px' }}>
              {brokenCommitments.length} Promise{brokenCommitments.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: brokenCommitments.length > 0 ? 'var(--rose)' : 'var(--text-muted)' }}>
              {brokenCommitments.length > 0 ? `${formatINR(brokenCommitmentsPaise.toString())} unfulfilled promise` : 'Zero broken promises'}
            </div>
          </div>

          {/* Signal 5: Payments Awaiting Verification */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: unverifiedPayments.length > 0 ? 'var(--amber-soft)' : 'var(--surface)',
              border: `1px solid ${unverifiedPayments.length > 0 ? 'var(--amber-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('verify')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: unverifiedPayments.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
                Awaiting Verification
              </span>
              <ShieldCheck size={15} color={unverifiedPayments.length > 0 ? 'var(--amber)' : '#9CA3AF'} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: unverifiedPayments.length > 0 ? '#B45309' : 'var(--text)', margin: '4px 0 2px' }}>
              {unverifiedPayments.length} Payment{unverifiedPayments.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: unverifiedPayments.length > 0 ? '#92400E' : 'var(--text-muted)' }}>
              {unverifiedPayments.length > 0 ? `${formatINR(unverifiedTotalPaise.toString())} pending ledger review` : 'All payments confirmed'}
            </div>
          </div>

          {/* Signal 6: Unmatched Bank Transactions */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: unmatchedTransactions.length > 0 ? 'var(--primary-soft)' : 'var(--surface)',
              border: `1px solid ${unmatchedTransactions.length > 0 ? 'var(--primary-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('payments')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: unmatchedTransactions.length > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                Unmatched Inflows
              </span>
              <ArrowDownLeft size={15} color={unmatchedTransactions.length > 0 ? 'var(--primary)' : '#9CA3AF'} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: unmatchedTransactions.length > 0 ? 'var(--primary)' : 'var(--text)', margin: '4px 0 2px' }}>
              {unmatchedTransactions.length} Inflow{unmatchedTransactions.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: unmatchedTransactions.length > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
              {unmatchedTransactions.length > 0 ? `${formatINR(unmatchedTotalPaise.toString())} requires counterparty match` : 'All bank inflows matched'}
            </div>
          </div>

          {/* Signal 7: Upcoming Supplier Payments */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('ledgers')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>Supplier Obligations (7d)</span>
              <Clock size={15} color="var(--terracotta)" />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text)', margin: '4px 0 2px' }}>
              {upcomingBills7d.length} Bill{upcomingBills7d.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {upcomingBills7d.length > 0 ? `${formatINR(upcoming7dOutflowsPaise.toString())} due in next 7 days` : 'Zero bills due this week'}
            </div>
          </div>

          {/* Signal 8: Today's Collection Progress */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('ledgers')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>Collection Progress Today</span>
              <CheckCircle2 size={15} color="#15803D" />
            </div>
            {todayTarget ? (
              <>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--green)', margin: '4px 0 2px' }}>
                  {todayTarget.percentage}%
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {formatINR(todayTarget.collectedPaise.toString())} of {formatINR(todayTarget.targetPaise.toString())} target
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-muted)', margin: '4px 0 2px' }}>
                  No Target Due
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                  Zero invoices contracted due today
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── LEVEL 4: PRIORITISED ACTIONS & SUPPORTING INSIGHTS ─────── */}
      <section aria-label="Level 4 Actions and Supporting Insights">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            Level 4 — Prioritised Operational Actions
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-light)' }}>
            Ordered by financial impact and urgency
          </span>
        </div>

        {/* Action Cards List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {prioritizedActions.length > 0 ? (
            prioritizedActions.map((act) => {
              const isCrit = act.urgency === 'CRITICAL';
              const isHigh = act.urgency === 'HIGH';

              return (
                <div
                  key={act.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: '14px 18px',
                    background: 'var(--surface)',
                    border: `1px solid ${isCrit ? 'var(--rose-border)' : isHigh ? 'var(--amber-border)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 280 }}>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: isCrit ? 'var(--rose)' : isHigh ? 'var(--amber)' : 'var(--surface-alt)',
                        color: isCrit || isHigh ? '#FFFFFF' : 'var(--text-muted)',
                        marginTop: 2,
                        letterSpacing: '0.5px',
                      }}
                    >
                      {act.urgency}
                    </span>
                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text)' }}>
                        {act.title}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {act.reason}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {act.amountPaise !== undefined && (
                      <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text)', marginRight: 4 }}>
                        {formatINR(act.amountPaise.toString())}
                      </span>
                    )}
                    {act.whatsAppAction && (
                      <button
                        type="button"
                        onClick={() =>
                          setWhatsAppModal({
                            isOpen: true,
                            retailerId: act.whatsAppAction?.retailerId,
                            templateType: act.whatsAppAction?.templateType,
                          })
                        }
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: '#16A34A',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '5px 9px',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                        title="Prepare personalized WhatsApp message"
                      >
                        <MessageSquare size={12} /> WhatsApp
                      </button>
                    )}
                    <button
                      className={`btn btn-sm ${isCrit ? 'btn-danger' : isHigh ? 'btn-primary' : ''}`}
                      onClick={() => onNavigate(act.targetPage)}
                      style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                    >
                      {act.actionText} →
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                background: 'var(--surface)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                color: 'var(--green)',
                fontWeight: 600,
              }}
            >
              ✓ Zero immediate critical operational tasks. All ledgers, collections, and obligations are on schedule.
            </div>
          )}
        </div>

        {/* Supporting Information Grid: Top Retailers & Recent Payments */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {/* Supporting Box A: Top Retailers by Receivables */}
          <div
            className="card"
            style={{
              padding: '16px 18px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text)' }}>
                Top Retailers by Outstanding Receivables
              </span>
              <button
                className="btn btn-sm"
                onClick={() => onNavigate('retailers')}
                style={{ fontSize: '0.74rem', padding: '2px 8px' }}
              >
                View All →
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topRetailers.length > 0 ? (
                topRetailers.map(({ retailer, outstandingPaise, overdueCount }) => (
                  <div
                    key={retailer.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: 'var(--surface-alt)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {retailer.name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {retailer.code} {overdueCount > 0 && <span style={{ color: 'var(--rose)', fontWeight: 700 }}>· {overdueCount} overdue</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <div style={{ fontWeight: 800, color: 'var(--text)' }}>
                        {formatINR(outstandingPaise.toString())}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => onNavigate('risk')}
                          style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}
                        >
                          Risk Radar →
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setWhatsAppModal({
                              isOpen: true,
                              retailerId: retailer.id,
                              templateType: overdueCount > 0 ? 'OVERDUE_REMINDER' : 'UPCOMING_REMINDER',
                            })
                          }
                          style={{
                            background: '#DCFCE7',
                            color: '#166534',
                            border: '1px solid #86EFAC',
                            borderRadius: '3px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '1px 5px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                          title="Prepare WhatsApp message"
                        >
                          <MessageSquare size={10} /> WhatsApp
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No active customer invoices
                </div>
              )}
            </div>
          </div>

          {/* Supporting Box B: Recent Verified Payments */}
          <div
            className="card"
            style={{
              padding: '16px 18px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text)' }}>
                Recent Verified Payment Activity
              </span>
              <button
                className="btn btn-sm"
                onClick={() => onNavigate('payments')}
                style={{ fontSize: '0.74rem', padding: '2px 8px' }}
              >
                Payments Queue →
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentVerifiedPayments.length > 0 ? (
                recentVerifiedPayments.map((pmt) => (
                  <div
                    key={pmt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: 'var(--surface-alt)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {pmt.narration || pmt.payerDisplayName || 'Direct Bank Inflow'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {pmt.valueDate} · {pmt.paymentMethod}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: 'var(--green)' }}>
                        +{formatINR(pmt.amountPaise)}
                      </div>
                      <span style={{ fontSize: '0.7rem', color: '#15803D', fontWeight: 600 }}>
                        VERIFIED
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No recent verified payments recorded
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Ledger & Audit Transparency Drawer */}
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setShowDetailedLedger(!showDetailedLedger)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '6px 0',
            }}
          >
            {showDetailedLedger ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showDetailedLedger ? 'Hide Detailed Financial Ledger' : 'Show Detailed Ledger & Balance Reconciliation'}
          </button>

          {showDetailedLedger && (
            <div
              style={{
                marginTop: 10,
                padding: '16px 20px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 8, color: 'var(--text)' }}>
                Double-Entry Balance Reconciliation
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Opening Operating Cash (Verified)</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>{formatINR(openingCashPaise.toString())}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Total Outstanding Customer Invoices</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>+{formatINR(totalReceivablesPaise.toString())}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Overdue Receivables (Past Due Terms)</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--rose)', fontWeight: 700 }}>{formatINR(overdueReceivablesPaise.toString())}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Upcoming Supplier Bills (Scheduled)</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--terracotta)', fontWeight: 700 }}>-{formatINR(upcoming7dBillsPaise.toString())}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Operating Expenses (Scheduled)</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--terracotta)', fontWeight: 700 }}>-{formatINR(upcoming7dExpensesPaise.toString())}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Emergency Reserve Fund (Segregated)</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>{formatINR(currentReservePaise.toString())}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Smart WhatsApp Message Generation Modal */}
      <WhatsAppMessageModal
        isOpen={whatsAppModal.isOpen}
        onClose={() => setWhatsAppModal({ isOpen: false })}
        businessId={business.id}
        workspace={workspace}
        initialRetailerId={whatsAppModal.retailerId}
        initialInvoiceId={whatsAppModal.invoiceId}
        initialTemplateType={whatsAppModal.templateType}
        onSuccess={() => onRefresh()}
      />
    </div>
  );
};
