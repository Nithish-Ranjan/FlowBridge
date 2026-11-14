import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  SlidersHorizontal,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Info,
  Plus,
  Trash2,
  HelpCircle,
  FileText,
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
  addDays,
  compareIsoDate,
  validateScenarioActions,
  parseScenarioIntent,
  type CustomerInvoiceDTO,
  type OperatingExpenseDTO,
  type SupplierBillDTO,
  type ForecastResult,
  type ScenarioActionInput,
} from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';
import type { TransferredScenario } from '../App';

interface WhatIfControlRoomProps {
  workspace: WorkspacePayload;
  horizonDays?: number;
  initialScenario?: TransferredScenario | null;
  onClearInitialScenario?: () => void;
  onJumpToResolve?: () => void;
  onEvaluateScenario?: (actions: ScenarioActionInput[]) => Promise<ForecastResult>;
  onSaveScenario?: (name: string, kind: 'RESOLUTION_PLAN' | 'SHOCKWAVE_WHAT_IF', actions: ScenarioActionInput[]) => Promise<void>;
}

export const WhatIfControlRoom: React.FC<WhatIfControlRoomProps> = ({
  workspace,
  horizonDays = 30,
  initialScenario,
  onClearInitialScenario,
  onJumpToResolve,
  onEvaluateScenario,
  onSaveScenario,
}) => {
  const { business } = workspace;
  const day0 = business.openingCashDate;

  // Active custom/transferred scenario actions
  const [activeActions, setActiveActions] = useState<ScenarioActionInput[]>([]);
  const [activeScenarioMeta, setActiveScenarioMeta] = useState<{
    title: string;
    subtitle: string;
    source: 'RESOLUTION_AUTOPILOT' | 'PRESET' | 'NATURAL_LANGUAGE' | 'CUSTOM';
  } | null>(null);

  // Quick slider parameters (applied when no custom actions are active)
  const [earlyCollectionRupees, setEarlyCollectionRupees] = useState<number>(0);
  const [supplierShiftDays, setSupplierShiftDays] = useState<number>(0);
  const [customerDelayDays, setCustomerDelayDays] = useState<number>(0);
  const [reserveDrawRupees, setReserveDrawRupees] = useState<number>(0);

  // Natural Language State inside What-If
  const [nlQuery, setNlQuery] = useState('');
  const [nlFeedback, setNlFeedback] = useState<{
    type: 'RESOLVED' | 'AMBIGUOUS' | 'UNKNOWN';
    message: string;
    category?: 'DELAY_RETAILER' | 'DEFER_SUPPLIER' | 'CHOOSE_RESOLUTION';
    actions?: ScenarioActionInput[];
    title?: string;
    subtitle?: string;
    candidateInvoices?: CustomerInvoiceDTO[];
    candidateBills?: SupplierBillDTO[];
    suggestedDays?: number;
  } | null>(null);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [selectedBillId, setSelectedBillId] = useState('');
  const [selectedDays, setSelectedDays] = useState(5);

  // Server-evaluated forecast state
  const [evaluatedForecast, setEvaluatedForecast] = useState<ForecastResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  const latestEvalReqIdRef = useRef<number>(0);

  // Find top eligible customer invoice and supplier bill dynamically
  const primaryInvoice = useMemo(() => {
    return workspace.invoices
      .filter((inv) => inv.status !== 'PAID' && inv.status !== 'CANCELLED' && parsePaise(inv.outstandingPaise) > 0n)
      .sort((a, b) => (parsePaise(a.outstandingPaise) > parsePaise(b.outstandingPaise) ? -1 : 1))[0];
  }, [workspace.invoices]);

  const primaryBill = useMemo(() => {
    return workspace.bills
      .filter((b) => b.status !== 'PAID' && b.status !== 'CANCELLED' && parsePaise(b.outstandingPaise) > 0n)
      .sort((a, b) => (parsePaise(a.outstandingPaise) > parsePaise(b.outstandingPaise) ? -1 : 1))[0];
  }, [workspace.bills]);

  const minThresholdPaise = parsePaise(business.minimumCashPaise || '0');
  const minThresholdRupees = Number(minThresholdPaise) / 100;
  const openingCashPaise = parsePaise(business.openingCashPaise || '0');

  // Compute Baseline Forecast
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

  // Handle incoming transferred scenario from Resolution Autopilot
  useEffect(() => {
    if (initialScenario && initialScenario.actions.length > 0) {
      setActiveActions(initialScenario.actions);
      setActiveScenarioMeta({
        title: initialScenario.title,
        subtitle: initialScenario.subtitle || 'Transferred from Resolution Autopilot',
        source: initialScenario.source,
      });
      // Reset sliders to 0 so custom actions take precedence
      setEarlyCollectionRupees(0);
      setSupplierShiftDays(0);
      setCustomerDelayDays(0);
      setReserveDrawRupees(0);
    }
  }, [initialScenario]);

  // Trigger backend scenario evaluation whenever activeActions change
  useEffect(() => {
    if (activeActions.length === 0) {
      setEvaluatedForecast(null);
      setEvalError(null);
      return;
    }

    // Validate actions before evaluating
    const validation = validateScenarioActions(activeActions, {
      invoices: workspace.invoices,
      bills: workspace.bills,
      expenses: workspace.expenses,
      asOfDate: day0,
      limits: business.approvalLimits,
    });

    if (!validation.valid) {
      setEvalError(`Scenario Validation Failed: ${validation.error}`);
      setEvaluatedForecast(null);
      return;
    }

    setEvalError(null);
    setIsEvaluating(true);
    const reqId = ++latestEvalReqIdRef.current;

    if (onEvaluateScenario) {
      onEvaluateScenario(activeActions)
        .then((forecast) => {
          if (reqId === latestEvalReqIdRef.current) {
            setEvaluatedForecast(forecast);
            setIsEvaluating(false);
          }
        })
        .catch((err) => {
          if (reqId === latestEvalReqIdRef.current) {
            setEvalError(err.message || 'Failed to evaluate scenario forecast on server.');
            setIsEvaluating(false);
          }
        });
    } else {
      setIsEvaluating(false);
    }
  }, [activeActions, workspace, business, day0, onEvaluateScenario]);

  // Compute simulated forecast purely in-memory if no custom actions (slider mode)
  const localSimulatedForecast = useMemo(() => {
    if (evaluatedForecast) return evaluatedForecast;

    // 1. Invoices
    const simInvoices: CustomerInvoiceDTO[] = workspace.invoices.map((inv) => {
      if (primaryInvoice && inv.id === primaryInvoice.id && customerDelayDays > 0) {
        return { ...inv, dueDate: addDays(inv.dueDate, customerDelayDays) };
      }
      return { ...inv };
    });

    if (earlyCollectionRupees > 0 && primaryInvoice) {
      const earlyDate = addDays(day0, 2);
      simInvoices.push({
        id: `sim-early-${primaryInvoice.id}`,
        businessId: business.id,
        retailerId: primaryInvoice.retailerId,
        retailerCode: primaryInvoice.retailerCode,
        retailerName: `${primaryInvoice.retailerName ?? 'Retailer'} (Simulated Early)`,
        invoiceNumber: `SIM-${primaryInvoice.invoiceNumber}`,
        invoiceDate: day0,
        dueDate: earlyDate,
        totalAmountPaise: paiseToString(BigInt(earlyCollectionRupees) * 100n),
        paidAmountPaise: '0',
        outstandingPaise: paiseToString(BigInt(earlyCollectionRupees) * 100n),
        status: 'OPEN',
        evidenceStatus: 'CONFIRMED_PROMISE',
        externalReference: 'SIM-EARLY',
        recordOrigin: 'MANUAL_ENTRY',
        notes: 'Simulated early collection in What-If control room',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. Bills
    const simBills: SupplierBillDTO[] = workspace.bills.map((bill) => {
      if (primaryBill && bill.id === primaryBill.id && supplierShiftDays > 0) {
        return { ...bill, dueDate: addDays(bill.dueDate, supplierShiftDays) };
      }
      return { ...bill };
    });

    // 3. Opening cash buffer
    const simOpeningCash = openingCashPaise + BigInt(reserveDrawRupees) * 100n;

    return computeCashForecast({
      businessId: business.id,
      asOfDate: day0,
      horizonDays,
      openingCashPaise: paiseToString(simOpeningCash),
      minimumCashPaise: business.minimumCashPaise,
      invoices: simInvoices,
      bills: simBills,
      expenses: workspace.expenses,
    });
  }, [
    evaluatedForecast,
    workspace,
    business,
    day0,
    horizonDays,
    primaryInvoice,
    primaryBill,
    earlyCollectionRupees,
    supplierShiftDays,
    customerDelayDays,
    reserveDrawRupees,
    openingCashPaise,
  ]);

  const activeForecast = evaluatedForecast || localSimulatedForecast;

  // Chart series combining baseline and simulated
  const chartData = baselineForecast.days.map((baseDay, idx) => {
    const simDay = activeForecast.days[idx] || baseDay;
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

  const simLowestBalancePaise = parsePaise(activeForecast.breach.lowestBalancePaise || '0');
  const isResolved = !activeForecast.breach.firstBreachDate;

  // Reset all simulation parameters
  const handleReset = () => {
    setActiveActions([]);
    setActiveScenarioMeta(null);
    setEvaluatedForecast(null);
    setEvalError(null);
    setSaveSuccessNotice(null);
    setEarlyCollectionRupees(0);
    setSupplierShiftDays(0);
    setCustomerDelayDays(0);
    setReserveDrawRupees(0);
    if (onClearInitialScenario) {
      onClearInitialScenario();
    }
  };

  // Quick Preset Handlers
  const handleApplyPresetEarlyCollection = () => {
    handleReset();
    if (primaryInvoice) {
      const out = Number(parsePaise(primaryInvoice.outstandingPaise) / 100n);
      const half = Math.round(out * 0.5);
      setEarlyCollectionRupees(half > 0 ? half : 40000);
    } else {
      setEarlyCollectionRupees(40000);
    }
  };

  const handleApplyPresetSupplierShift = () => {
    handleReset();
    setSupplierShiftDays(7);
  };

  const handleApplyPresetReserveDraw = () => {
    handleReset();
    setReserveDrawRupees(30000);
  };

  // Handle Natural Language Query inside What-If
  const handleEvaluateNlQuery = (queryText: string) => {
    setEvalError(null);
    const parsed = parseScenarioIntent(queryText, {
      invoices: workspace.invoices,
      bills: workspace.bills,
      asOfDate: day0,
    });

    if (parsed.type === 'RESOLVED') {
      setActiveActions(parsed.actions);
      setActiveScenarioMeta({
        title: parsed.title,
        subtitle: parsed.subtitle,
        source: 'NATURAL_LANGUAGE',
      });
      setNlFeedback({
        type: 'RESOLVED',
        message: parsed.explanation,
        title: parsed.title,
        subtitle: parsed.subtitle,
        actions: parsed.actions,
      });
    } else if (parsed.type === 'AMBIGUOUS') {
      setNlFeedback({
        type: 'AMBIGUOUS',
        message: parsed.message,
        category: parsed.category,
        candidateInvoices: parsed.candidateInvoices,
        candidateBills: parsed.candidateBills,
        suggestedDays: parsed.suggestedDays || 5,
      });
      if (parsed.candidateInvoices && parsed.candidateInvoices.length > 0) {
        setSelectedInvoiceId(parsed.candidateInvoices[0].id);
      }
      if (parsed.candidateBills && parsed.candidateBills.length > 0) {
        setSelectedBillId(parsed.candidateBills[0].id);
      }
      setSelectedDays(parsed.suggestedDays || 5);
    } else {
      setNlFeedback({
        type: 'UNKNOWN',
        message: parsed.message,
      });
    }
  };

  const handleExecuteDisambiguatedNl = () => {
    if (!nlFeedback || nlFeedback.type !== 'AMBIGUOUS') return;

    if (nlFeedback.category === 'DELAY_RETAILER') {
      const inv = workspace.invoices.find((i) => i.id === selectedInvoiceId);
      if (!inv) {
        setEvalError('Selected invoice not found in current records.');
        return;
      }
      const days = Number(selectedDays) || 5;
      const simDate = addDays(inv.dueDate, days);
      const actions: ScenarioActionInput[] = [
        {
          id: `nl-delay-${inv.id}`,
          targetType: 'CUSTOMER_INVOICE',
          targetId: inv.id,
          targetLabel: `${inv.invoiceNumber} (${inv.retailerName ?? 'Retailer'}) Delayed ${days}D`,
          actionType: 'DELAY_INFLOW',
          amountPaise: inv.outstandingPaise,
          originalDate: inv.dueDate,
          simulatedDate: simDate,
        },
      ];

      setActiveActions(actions);
      setActiveScenarioMeta({
        title: `What-If: ${inv.retailerName ?? inv.retailerCode} Delayed ${days} Days`,
        subtitle: `Invoice ${inv.invoiceNumber} shifted to ${simDate}`,
        source: 'NATURAL_LANGUAGE',
      });
      setNlFeedback(null);
    } else if (nlFeedback.category === 'DEFER_SUPPLIER') {
      const bill = workspace.bills.find((b) => b.id === selectedBillId);
      if (!bill) {
        setEvalError('Selected supplier bill not found in current records.');
        return;
      }
      const days = Number(selectedDays) || 7;
      const simDate = addDays(bill.dueDate, days);
      const actions: ScenarioActionInput[] = [
        {
          id: `nl-defer-${bill.id}`,
          targetType: 'SUPPLIER_BILL',
          targetId: bill.id,
          targetLabel: `${bill.billNumber} (${bill.supplierName ?? 'Supplier'}) Deferred ${days}D`,
          actionType: 'DEFER_OUTFLOW',
          amountPaise: bill.outstandingPaise,
          originalDate: bill.dueDate,
          simulatedDate: simDate,
        },
      ];

      setActiveActions(actions);
      setActiveScenarioMeta({
        title: `What-If: ${bill.supplierName ?? bill.supplierCode} Deferred ${days} Days`,
        subtitle: `Bill ${bill.billNumber} shifted to ${simDate}`,
        source: 'NATURAL_LANGUAGE',
      });
      setNlFeedback(null);
    }
  };

  const handleSaveScenario = async () => {
    if (!onSaveScenario || activeActions.length === 0) return;
    try {
      const label = activeScenarioMeta?.title || 'What-If Simulation Scenario';
      await onSaveScenario(label, 'RESOLUTION_PLAN', activeActions);
      setSaveSuccessNotice(`Scenario "${label}" successfully saved to database!`);
      setTimeout(() => setSaveSuccessNotice(null), 5000);
    } catch (err: any) {
      setEvalError(err.message || 'Failed to save scenario.');
    }
  };

  const handleRemoveAction = (actionId?: string) => {
    if (!actionId) return;
    setActiveActions((prev) => prev.filter((a) => a.id !== actionId));
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── RETURN TO RESOLUTION AUTOPILOT HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        {onJumpToResolve && (
          <button
            onClick={onJumpToResolve}
            className="btn"
            style={{
              fontSize: '0.84rem',
              fontWeight: 700,
              color: 'var(--primary)',
              border: '1.5px solid var(--primary-border)',
              background: 'var(--surface)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ArrowLeft size={16} /> Return to Resolution Autopilot
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleApplyPresetEarlyCollection}
            className="btn btn-sm"
            style={{ fontSize: '0.76rem', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            ⚡ Early Inflow Lever
          </button>
          <button
            onClick={handleApplyPresetSupplierShift}
            className="btn btn-sm"
            style={{ fontSize: '0.76rem', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            📅 7D Supplier Deferral
          </button>
          <button
            onClick={handleApplyPresetReserveDraw}
            className="btn btn-sm"
            style={{ fontSize: '0.76rem', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            🛡️ Reserve Drawdown
          </button>
          <button
            onClick={handleReset}
            className="btn btn-sm btn-danger"
            style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RotateCcw size={13} /> Reset Sandbox
          </button>
        </div>
      </div>

      {/* ── TRANSFERRED SCENARIO CALLOUT BANNER ── */}
      {activeScenarioMeta && (
        <div
          style={{
            borderRadius: 12,
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
            border: '1.5px solid var(--primary-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 14,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--primary)',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
              }}
            >
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    background: 'var(--primary)',
                    color: '#FFFFFF',
                    padding: '2px 8px',
                    borderRadius: 10,
                  }}
                >
                  {activeScenarioMeta.source === 'RESOLUTION_AUTOPILOT'
                    ? 'Transferred from Autopilot'
                    : 'Transferred Scenario'}
                </span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary-dark)' }}>
                  {activeScenarioMeta.title}
                </h3>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {activeScenarioMeta.subtitle} • {activeActions.length} active parameter action(s) modeled
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onSaveScenario && activeActions.length > 0 && (
              <button
                onClick={handleSaveScenario}
                className="btn btn-sm btn-primary"
                style={{ fontWeight: 700 }}
              >
                💾 Save Scenario to DB
              </button>
            )}
            <button
              onClick={handleReset}
              className="btn btn-sm"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              Clear Transferred
            </button>
          </div>
        </div>
      )}

      {saveSuccessNotice && (
        <div className="banner banner-success">
          <div>{saveSuccessNotice}</div>
          <button className="btn btn-sm" onClick={() => setSaveSuccessNotice(null)}>✕</button>
        </div>
      )}

      {evalError && (
        <div className="banner banner-error">
          <div><strong>Scenario Error:</strong> {evalError}</div>
          <button className="btn btn-sm" onClick={() => setEvalError(null)}>✕</button>
        </div>
      )}

      {/* ── SCENARIO STATUS BANNER ── */}
      <div
        style={{
          borderRadius: 14,
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
              padding: 10,
              borderRadius: 12,
              background: isResolved ? 'var(--green)' : 'var(--rose)',
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
                : 'Scenario Still Breaches Minimum Liquidity Floor'}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: isResolved ? '#166534' : '#991B1B' }}>
              Baseline peak shortage was{' '}
              <strong>{formatINR(baselineShortagePaise.toString())}</strong> on{' '}
              {baselineForecast.breach.firstBreachDate || 'Day 4'}.
              {isResolved
                ? ' Modeled scenario keeps closing cash strictly above your minimum threshold throughout the horizon.'
                : ' Adjust the parameters below or test deferral levers to close the remaining gap.'}
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
              fontSize: '1.65rem',
              fontWeight: 800,
              fontFamily: 'monospace',
              color: isResolved ? '#15803D' : '#B91C1C',
            }}
          >
            {formatINR(simLowestBalancePaise.toString())}
          </span>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Threshold: {formatINR(business.minimumCashPaise)}
          </div>
        </div>
      </div>

      {/* ── COMPARATIVE CASH FLOW CURVE (BASELINE VS SIMULATED) ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          padding: 24,
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
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text)' }}>
              Comparative Cash Flow Curve (Baseline vs Simulated Scenario)
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Deterministic daily forecast comparison evaluating sandbox adjustments against actual commitments.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.78rem', fontFamily: 'monospace' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
              <span style={{ width: 14, height: 2, background: '#94A3B8', display: 'inline-block' }} /> Baseline
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontWeight: 700 }}>
              <span style={{ width: 14, height: 3, background: 'var(--primary)', display: 'inline-block' }} /> Simulated
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--rose)' }}>
              <span style={{ width: 14, height: 1, borderTop: '2px dashed var(--rose)', display: 'inline-block' }} /> Threshold ({formatINR(business.minimumCashPaise)})
            </span>
          </div>
        </div>

        {isEvaluating && (
          <div style={{ padding: '8px 0', fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}>
            ⏳ Running backend deterministic scenario evaluation...
          </div>
        )}

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
              <ReferenceLine y={minThresholdRupees} stroke="var(--rose)" strokeDasharray="4 4" />
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
                stroke="var(--primary)"
                strokeWidth={3}
                dot={{ r: 2, fill: 'var(--primary)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── ACTIVE TRANSFERRED SCENARIO ACTIONS TABLE (IF ACTIVE) ── */}
      {activeActions.length > 0 && (
        <div
          className="card"
          style={{
            background: 'var(--surface)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            padding: 20,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text)' }}>
                Active Transferred Scenario Actions ({activeActions.length})
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                These parameters were transferred from Resolution Autopilot and are evaluated in the scenario engine above.
              </p>
            </div>
            <button
              onClick={() => setActiveActions([])}
              className="btn btn-sm"
              style={{ fontSize: '0.74rem' }}
            >
              Clear Actions & Use Sliders
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action Type</th>
                  <th>Target Record</th>
                  <th>Amount</th>
                  <th>Original Date</th>
                  <th>Simulated Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeActions.map((act) => (
                  <tr key={act.id || act.targetLabel}>
                    <td>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 12,
                          background:
                            act.actionType === 'ACCELERATE_INFLOW'
                              ? 'var(--green-soft)'
                              : act.actionType === 'DEFER_OUTFLOW'
                              ? 'var(--primary-soft)'
                              : 'var(--amber-soft)',
                          color:
                            act.actionType === 'ACCELERATE_INFLOW'
                              ? 'var(--green)'
                              : act.actionType === 'DEFER_OUTFLOW'
                              ? 'var(--primary)'
                              : 'var(--amber)',
                          border: '1px solid currentColor',
                        }}
                      >
                        {act.actionType}
                      </span>
                    </td>
                    <td>
                      <strong>{act.targetLabel}</strong>
                    </td>
                    <td className="num">
                      {act.actionType === 'DROP_INFLOW_PCT'
                        ? `${act.amountPaise}% Drop`
                        : formatINR(act.amountPaise)}
                    </td>
                    <td className="num">{act.originalDate || '—'}</td>
                    <td className="num">
                      <strong>{act.simulatedDate}</strong>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleRemoveAction(act.id)}
                        style={{ padding: '2px 6px' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── NATURAL LANGUAGE SCENARIO PROMPT INSIDE WHAT-IF ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          padding: 20,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Sparkles size={18} color="var(--primary)" />
          <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text)' }}>
            Natural Language Scenario Query
          </h3>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Type questions like "What if this retailer pays late?", "What if I delay this supplier payment?", or "Simulate a 20% collection drop".
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder='e.g., "What if this retailer pays late?" or "What if I delay Apex bill by 7 days?"'
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleEvaluateNlQuery(nlQuery);
              }
            }}
            style={{
              flex: 1,
              minWidth: 280,
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              fontSize: '0.88rem',
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => handleEvaluateNlQuery(nlQuery)}
            style={{ padding: '10px 20px', fontWeight: 700 }}
          >
            Apply Scenario →
          </button>
        </div>

        {/* Ambiguous selector prompt if needed */}
        {nlFeedback && nlFeedback.type === 'AMBIGUOUS' && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 8,
              background: 'var(--amber-soft)',
              border: '1px solid var(--amber-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <HelpCircle size={18} color="var(--amber)" />
              <strong style={{ fontSize: '0.84rem' }}>Clarification Required:</strong>
              <span style={{ fontSize: '0.82rem' }}>{nlFeedback.message}</span>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {nlFeedback.category === 'DELAY_RETAILER' && nlFeedback.candidateInvoices && (
                <select
                  value={selectedInvoiceId}
                  onChange={(e) => setSelectedInvoiceId(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                >
                  {nlFeedback.candidateInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.retailerName ?? inv.retailerCode} ({inv.invoiceNumber}) — {formatINR(inv.outstandingPaise)}
                    </option>
                  ))}
                </select>
              )}

              {nlFeedback.category === 'DEFER_SUPPLIER' && nlFeedback.candidateBills && (
                <select
                  value={selectedBillId}
                  onChange={(e) => setSelectedBillId(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                >
                  {nlFeedback.candidateBills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.supplierName ?? b.supplierCode} ({b.billNumber}) — {formatINR(b.outstandingPaise)}
                    </option>
                  ))}
                </select>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.8rem' }}>Days:</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={selectedDays}
                  onChange={(e) => setSelectedDays(Number(e.target.value))}
                  style={{ width: 64, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                />
              </div>

              <button
                className="btn btn-sm btn-primary"
                onClick={handleExecuteDisambiguatedNl}
                style={{ fontWeight: 700 }}
              >
                Apply to Sandbox →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── DYNAMIC PARAMETER SLIDERS ── */}
      <div
        className="card"
        style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          padding: 24,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text)' }}>
            Real-Time Simulation Levers & Controls
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Drag sliders below to model early receipts, delayed collections, supplier payment deferrals, or reserve draws against actual business records.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          {/* Lever 1: Early Collection */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                {primaryInvoice ? primaryInvoice.retailerName ?? 'Retailer' : 'Customer'} Early Collection
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--green)' }}>
                +₹{earlyCollectionRupees.toLocaleString('en-IN')}
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {primaryInvoice ? `Invoice ${primaryInvoice.invoiceNumber} (${formatINR(primaryInvoice.outstandingPaise)}). Model partial early collection.` : 'Model early collection.'}
            </p>
            <input
              type="range"
              min={0}
              max={primaryInvoice ? Math.min(150000, Number(parsePaise(primaryInvoice.outstandingPaise) / 100n)) : 80000}
              step={5000}
              value={earlyCollectionRupees}
              onChange={(e) => {
                setActiveActions([]);
                setEarlyCollectionRupees(Number(e.target.value));
              }}
              style={{ width: '100%', accentColor: 'var(--green)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>₹0</span>
              <span>₹40,000</span>
              <span>₹80,000+</span>
            </div>
          </div>

          {/* Lever 2: Supplier Shift */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                {primaryBill ? primaryBill.supplierName ?? 'Supplier' : 'Supplier'} Bill Deferral
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--primary)' }}>
                +{supplierShiftDays} Days
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {primaryBill ? `Bill ${primaryBill.billNumber} (${formatINR(primaryBill.outstandingPaise)}). Defer outflow past cash breach.` : 'Defer supplier bill.'}
            </p>
            <input
              type="range"
              min={0}
              max={15}
              step={1}
              value={supplierShiftDays}
              onChange={(e) => {
                setActiveActions([]);
                setSupplierShiftDays(Number(e.target.value));
              }}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>0d</span>
              <span>+7d (1 Week)</span>
              <span>+15d</span>
            </div>
          </div>

          {/* Lever 3: Customer Delay Stress Test */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                Customer Payment Delay (Stress Test)
              </label>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--rose)' }}>
                +{customerDelayDays} Days
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Stress-test: simulate customer delaying payment past scheduled due date.
            </p>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={customerDelayDays}
              onChange={(e) => {
                setActiveActions([]);
                setCustomerDelayDays(Number(e.target.value));
              }}
              style={{ width: '100%', accentColor: 'var(--rose)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>0d (On Time)</span>
              <span>+5d</span>
              <span>+20d (Severe)</span>
            </div>
          </div>

          {/* Lever 4: Reserve Drawdown */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
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
              Draw protected operating emergency reserve buffer to cover timing gap.
            </p>
            <input
              type="range"
              min={0}
              max={50000}
              step={5000}
              value={reserveDrawRupees}
              onChange={(e) => {
                setActiveActions([]);
                setReserveDrawRupees(Number(e.target.value));
              }}
              style={{ width: '100%', accentColor: '#7C3AED' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>₹0</span>
              <span>₹25,000</span>
              <span>₹50,000</span>
            </div>
          </div>
        </div>

        {/* Footer info callout */}
        <div
          style={{
            marginTop: 20,
            padding: '12px 16px',
            borderRadius: 10,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={16} color="var(--primary)" />
            <span>
              All simulations execute in isolated sandbox memory. Real invoices, supplier bills, ledgers, and bank records remain 100% pristine.
            </span>
          </div>
          {onJumpToResolve && (
            <button
              onClick={onJumpToResolve}
              className="btn btn-sm btn-primary"
              style={{ whiteSpace: 'nowrap', fontWeight: 700 }}
            >
              ← Back to Resolution Autopilot
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
