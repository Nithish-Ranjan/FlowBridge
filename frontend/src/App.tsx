import { useCallback, useEffect, useState } from 'react';
import {
  addDays,
  formatINR,
  parsePaise,
  type BusinessDTO,
  type ResolutionPlan,
  type ScenarioActionInput,
} from '@flowbridge/shared';
import { api, getStoredSessionToken, setStoredSessionToken, type DashboardResponse } from './api/client';
import { DashboardView } from './components/DashboardView';
import { ForecastView } from './components/ForecastView';
import { EmergencyReserveView } from './components/EmergencyReserveView';
import { DailyPlanView } from './components/DailyPlanView';
import { ResolveView } from './components/ResolveView';
import { WhatIfControlRoom } from './components/WhatIfControlRoom';
import { CommitmentsView } from './components/CommitmentsView';
import { LedgersView } from './components/LedgersView';
import { PaymentsView } from './components/PaymentsView';
import { VerifyView } from './components/VerifyView';
import { RetailerRiskView } from './components/RetailerRiskView';
import { RetailersView } from './components/RetailersView';
import { CreditAgreementsView } from './components/CreditAgreementsView';
import { NegotiationsView } from './components/NegotiationsView';
import { CommunicationsView } from './components/CommunicationsView';
import { AutomationView } from './components/AutomationView';
import { BusinessSettingsView } from './components/BusinessSettingsView';
import { SmartExitModal } from './components/SmartExitModal';
import { AuthView } from './components/AuthView';
import { LandingPage } from './components/LandingPage';
import { OnboardingModal } from './components/OnboardingModal';

export interface TransferredScenario {
  title: string;
  subtitle?: string;
  source: 'RESOLUTION_AUTOPILOT' | 'PRESET' | 'NATURAL_LANGUAGE' | 'CUSTOM';
  actions: ScenarioActionInput[];
  planId?: string;
  notes?: string;
  expectedOutcome?: string;
}

// ── 6 PRIMARY SECTIONS ──────────────────────────────────────────────
export type PrimarySection =
  | 'overview'
  | 'cashflow'
  | 'resolve'
  | 'transactions'
  | 'insights'
  | 'settings';

interface NavItem {
  key: PrimarySection;
  label: string;
  icon: string;
  description: string;
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { key: 'overview', label: 'Overview', icon: '⬡', description: 'Financial Command Centre' },
  { key: 'cashflow', label: 'Cash Flow', icon: '📈', description: 'Forecast, Reserves & Plans' },
  { key: 'resolve', label: 'Resolve', icon: '🎛️', description: 'Autopilot, What-If & Commitments' },
  { key: 'transactions', label: 'Transactions', icon: '📋', description: 'Invoices, Bills & Payments' },
  { key: 'insights', label: 'Insights & Reports', icon: '🎯', description: 'Risk, Retailers & Contracts' },
  { key: 'settings', label: 'Communication & Settings', icon: '⚙️', description: 'WhatsApp, Automation & Settings' },
];

export function App() {
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [businesses, setBusinesses] = useState<BusinessDTO[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [horizonDays, setHorizonDays] = useState<number>(15);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);

  // Primary Section Navigation State (6 items)
  const [primarySection, setPrimarySection] = useState<PrimarySection>('overview');

  // Internal Subtab State for each primary section
  const [cashFlowTab, setCashFlowTab] = useState<'forecast' | 'reserve' | 'daily-plan'>('forecast');
  const [resolveTab, setResolveTab] = useState<'autopilot' | 'what-if' | 'commitments'>('autopilot');
  const [transactionsTab, setTransactionsTab] = useState<'ledgers' | 'payments' | 'verify'>('ledgers');
  const [insightsTab, setInsightsTab] = useState<'risk' | 'retailers' | 'agreements' | 'negotiations'>('risk');
  const [settingsTab, setSettingsTab] = useState<'communications' | 'automation' | 'business-settings'>('communications');

  const [transferredScenario, setTransferredScenario] = useState<TransferredScenario | null>(null);
  const [targetContactForChat, setTargetContactForChat] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Check stored auth session
  useEffect(() => {
    const token = getStoredSessionToken();
    if (token) {
      api
        .getMe()
        .then((res) => {
          setCurrentUser(res.user);
        })
        .catch(() => {
          setStoredSessionToken(null);
          setCurrentUser(null);
        });
    }
  }, []);

  const loadBusinessesAndDashboard = useCallback(
    async (targetBizId?: string, targetHorizon = horizonDays) => {
      setLoading(true);
      setError(null);
      try {
        const listRes = await api.listBusinesses();
        setBusinesses(listRes.businesses);
        const chosen = targetBizId || selectedBusinessId || listRes.businesses[0]?.id || '';
        if (chosen) {
          setSelectedBusinessId(chosen);
          const dash = await api.getDashboard(chosen, targetHorizon);
          setDashboard(dash);
        } else {
          setDashboard(null);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [horizonDays, selectedBusinessId],
  );

  useEffect(() => {
    void loadBusinessesAndDashboard();
  }, []);

  async function refreshDashboard(bizId = selectedBusinessId, h = horizonDays) {
    if (!bizId) return;
    const dash = await api.getDashboard(bizId, h);
    setDashboard(dash);
  }

  async function runActionResult(message: string, fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refreshDashboard();
      setNotice(message);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runAction(message: string, fn: () => Promise<void>): Promise<void> {
    await runActionResult(message, fn);
  }

  /**
   * Universal navigation router that supports both primary sections
   * and legacy sub-page keys without breaking any existing link.
   */
  const handleNavigate = useCallback((target: string) => {
    switch (target) {
      case 'overview':
        setPrimarySection('overview');
        break;

      case 'cashflow':
        setPrimarySection('cashflow');
        break;
      case 'forecast':
        setPrimarySection('cashflow');
        setCashFlowTab('forecast');
        break;
      case 'reserve':
        setPrimarySection('cashflow');
        setCashFlowTab('reserve');
        break;
      case 'reports':
      case 'daily-plan':
        setPrimarySection('cashflow');
        setCashFlowTab('daily-plan');
        break;

      case 'resolve':
      case 'autopilot':
        setPrimarySection('resolve');
        setResolveTab('autopilot');
        break;
      case 'what-if':
        setPrimarySection('resolve');
        setResolveTab('what-if');
        break;
      case 'commitments':
        setPrimarySection('resolve');
        setResolveTab('commitments');
        break;

      case 'transactions':
        setPrimarySection('transactions');
        break;
      case 'ledgers':
        setPrimarySection('transactions');
        setTransactionsTab('ledgers');
        break;
      case 'payments':
        setPrimarySection('transactions');
        setTransactionsTab('payments');
        break;
      case 'verify':
        setPrimarySection('transactions');
        setTransactionsTab('verify');
        break;

      case 'insights':
        setPrimarySection('insights');
        break;
      case 'risk':
        setPrimarySection('insights');
        setInsightsTab('risk');
        break;
      case 'retailers':
        setPrimarySection('insights');
        setInsightsTab('retailers');
        break;
      case 'agreements':
        setPrimarySection('insights');
        setInsightsTab('agreements');
        break;
      case 'negotiations':
        setPrimarySection('insights');
        setInsightsTab('negotiations');
        break;

      case 'settings':
        setPrimarySection('settings');
        break;
      case 'communications':
        setPrimarySection('settings');
        setSettingsTab('communications');
        break;
      case 'automation':
        setPrimarySection('settings');
        setSettingsTab('automation');
        break;
      case 'business-settings':
        setPrimarySection('settings');
        setSettingsTab('business-settings');
        break;

      default:
        setPrimarySection('overview');
        break;
    }
  }, []);

  async function handleProposePlan(plan: ResolutionPlan) {
    if (!dashboard) return;
    await runAction(
      `Proposed ${plan.actions.length} commitment(s). Awaiting human reply before affecting forecast.`,
      async () => {
        const actions = plan.actions.map((a) => {
          if (a.targetType === 'CUSTOMER_INVOICE') {
            const inv = dashboard.workspace.invoices.find((i) => i.id === a.targetId);
            return {
              counterpartyType: 'RETAILER' as const,
              retailerId: inv?.retailerId ?? null,
              customerInvoiceId: a.targetId,
              actionType: 'EARLY_RECEIPT' as const,
              proposedAmountPaise: a.amountPaise,
              proposedDate: a.proposedDate,
            };
          }
          if (a.targetType === 'SUPPLIER_BILL') {
            const bill = dashboard.workspace.bills.find((b) => b.id === a.targetId);
            return {
              counterpartyType: 'SUPPLIER' as const,
              supplierId: bill?.supplierId ?? null,
              supplierBillId: a.targetId,
              actionType: 'SUPPLIER_DEFERRAL' as const,
              proposedAmountPaise: a.amountPaise,
              proposedDate: a.proposedDate,
            };
          }
          return {
            counterpartyType: 'EXPENSE' as const,
            operatingExpenseId: a.targetId,
            actionType: 'EXPENSE_DEFERRAL' as const,
            proposedAmountPaise: a.amountPaise,
            proposedDate: a.proposedDate,
          };
        });
        await api.proposeCommitments(dashboard.workspace.business.id, actions);
      },
    );
  }

  async function handleCreateBlueprintPlanAProposals() {
    if (!dashboard) return;
    const custAInv = dashboard.workspace.invoices.find((i) => i.invoiceNumber === 'C-3301') || dashboard.workspace.invoices[0];
    const supABill = dashboard.workspace.bills.find((b) => b.billNumber === 'S-2041') || dashboard.workspace.bills[0];
    if (!custAInv || !supABill) {
      setError('Blueprint records not found in workspace.');
      return;
    }
    const day4 = addDays(dashboard.workspace.business.openingCashDate, 4);
    const day12 = addDays(dashboard.workspace.business.openingCashDate, 12);
    await runAction('Created Blueprint Plan A Proposals (Customer A & Supplier A).', async () => {
      await api.proposeCommitments(dashboard.workspace.business.id, [
        {
          counterpartyType: 'RETAILER',
          retailerId: custAInv.retailerId,
          customerInvoiceId: custAInv.id,
          actionType: 'EARLY_RECEIPT',
          proposedAmountPaise: '2000000',
          proposedDate: day4,
        },
        {
          counterpartyType: 'SUPPLIER',
          supplierId: supABill.supplierId,
          supplierBillId: supABill.id,
          actionType: 'SUPPLIER_DEFERRAL',
          proposedAmountPaise: '3800000',
          proposedDate: day12,
        },
      ]);
    });
  }

  function handleExitLogout() {
    setStoredSessionToken(null);
    setCurrentUser(null);
    setShowExitModal(false);
    api.logout().catch(() => undefined);
  }

  // If user not signed in and has no session token, show Fintech Landing Page
  if (!currentUser && !getStoredSessionToken()) {
    if (showAuthModal) {
      return (
        <AuthView
          onClose={() => setShowAuthModal(false)}
          onSuccess={(user) => {
            setCurrentUser(user);
            setShowAuthModal(false);
            void loadBusinessesAndDashboard();
          }}
        />
      );
    }

    return (
      <>
        <LandingPage
          onSignInClick={() => setShowAuthModal(true)}
          onGetStartedClick={() => setShowOnboardingModal(true)}
          onExploreDemoClick={async () => {
            try {
              const res = await api.demoLogin();
              setStoredSessionToken(res.token);
              setCurrentUser(res.user);
              void loadBusinessesAndDashboard();
            } catch (err) {
              setShowAuthModal(true);
            }
          }}
        />
        <OnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
          onSuccess={(user) => {
            setCurrentUser(user);
            setShowOnboardingModal(false);
            void loadBusinessesAndDashboard();
          }}
        />
      </>
    );
  }

  return (
    <div className="app-shell">
      {/* ── TOP HEADER BAR ── */}
      <header
        style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 24px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--primary)', letterSpacing: '-0.5px' }}>
            FlowBridge
          </div>
          {dashboard?.workspace.business && (
            <span className="code-pill">
              {dashboard.workspace.business.code} · {dashboard.workspace.business.name}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {currentUser && (
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              👤 {currentUser.fullName} ({currentUser.role})
            </span>
          )}

          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              if (dashboard) setShowExitModal(true);
              else handleExitLogout();
            }}
          >
            Smart Exit
          </button>
        </div>
      </header>

      {/* ── SIMPLIFIED 6-SECTION SIDEBAR ── */}
      <aside className="sidebar" style={{ overflowY: 'auto' }}>
        <div className="sidebar-brand">
          <h1>FlowBridge 2.0</h1>
          <p>Financial Command & Liquidity</p>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Main Navigation</div>
          {PRIMARY_NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${primarySection === item.key ? 'active' : ''}`}
              onClick={() => setPrimarySection(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {businesses.length > 0 && (
            <select
              value={selectedBusinessId}
              onChange={(e) => void loadBusinessesAndDashboard(e.target.value, horizonDays)}
              style={{
                width: '100%',
                marginBottom: 8,
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface-alt)',
                color: 'var(--text)',
                fontSize: '0.78rem',
              }}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={horizonDays}
            onChange={(e) => {
              const nextH = Number(e.target.value);
              setHorizonDays(nextH);
              void loadBusinessesAndDashboard(selectedBusinessId, nextH);
            }}
            style={{
              width: '100%',
              marginBottom: 8,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-alt)',
              color: 'var(--text)',
              fontSize: '0.78rem',
            }}
          >
            <option value={15}>15-Day Horizon</option>
            <option value={30}>30-Day Horizon</option>
          </select>

          <button
            className="btn btn-sm"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={loading || busy}
            onClick={() => void loadBusinessesAndDashboard()}
          >
            🔄 Refresh Workspace
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT AREA ── */}
      <main className="main-content">
        {error && (
          <div className="banner banner-error" style={{ margin: '14px 28px 0' }}>
            <div><strong>Error:</strong> {error}</div>
            <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {notice && (
          <div className="banner banner-success" style={{ margin: '14px 28px 0' }}>
            <div>{notice}</div>
            <button className="btn btn-sm" onClick={() => setNotice(null)}>✕</button>
          </div>
        )}

        {loading && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>⬡</div>
            <p className="muted">Loading PostgreSQL workspace, deterministic forecast, and financial engines…</p>
          </div>
        )}

        {!loading && !dashboard && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚠️</div>
            <h3>No Business Configured</h3>
            <p className="muted">Ensure PostgreSQL is running and seed is applied.</p>
          </div>
        )}

        {!loading && dashboard && (
          <>
            {/* ════════════ 1. OVERVIEW ════════════ */}
            {primarySection === 'overview' && (
              <div className="page-body">
                <DashboardView
                  dashboard={dashboard}
                  busy={busy}
                  onNavigate={handleNavigate}
                  onRefresh={() => void loadBusinessesAndDashboard()}
                />
              </div>
            )}

            {/* ════════════ 2. CASH FLOW ════════════ */}
            {primarySection === 'cashflow' && (
              <>
                <div className="subnav-bar">
                  <button
                    className={`subnav-pill ${cashFlowTab === 'forecast' ? 'active' : ''}`}
                    onClick={() => setCashFlowTab('forecast')}
                  >
                    📈 Cash Forecast
                  </button>
                  <button
                    className={`subnav-pill ${cashFlowTab === 'reserve' ? 'active' : ''}`}
                    onClick={() => setCashFlowTab('reserve')}
                  >
                    🛡️ Emergency Reserve
                  </button>
                  <button
                    className={`subnav-pill ${cashFlowTab === 'daily-plan' ? 'active' : ''}`}
                    onClick={() => setCashFlowTab('daily-plan')}
                  >
                    🎙️ Daily Financial Plan
                  </button>
                </div>

                <div className="page-body">
                  {cashFlowTab === 'forecast' && (
                    <ForecastView
                      workspace={dashboard.workspace}
                      forecast={dashboard.forecast}
                      busy={busy}
                      onJumpToResolve={() => {
                        setPrimarySection('resolve');
                        setResolveTab('autopilot');
                      }}
                      onSaveSnapshot={(label) =>
                        runAction(`Saved forecast snapshot "${label}".`, async () => {
                          await api.saveForecastSnapshot(dashboard.workspace.business.id, horizonDays, label);
                        })
                      }
                    />
                  )}

                  {cashFlowTab === 'reserve' && (
                    <EmergencyReserveView businessId={dashboard.workspace.business.id} />
                  )}

                  {cashFlowTab === 'daily-plan' && (
                    <DailyPlanView businessId={dashboard.workspace.business.id} />
                  )}
                </div>
              </>
            )}

            {/* ════════════ 3. RESOLVE ════════════ */}
            {primarySection === 'resolve' && (
              <>
                <div className="subnav-bar">
                  <button
                    className={`subnav-pill ${resolveTab === 'autopilot' ? 'active' : ''}`}
                    onClick={() => setResolveTab('autopilot')}
                  >
                    🧩 Resolution Autopilot
                  </button>
                  <button
                    className={`subnav-pill ${resolveTab === 'what-if' ? 'active' : ''}`}
                    onClick={() => setResolveTab('what-if')}
                  >
                    🎛️ What-If Simulator
                  </button>
                  <button
                    className={`subnav-pill ${resolveTab === 'commitments' ? 'active' : ''}`}
                    onClick={() => setResolveTab('commitments')}
                  >
                    🤝 Track Commitments
                  </button>
                </div>

                <div className="page-body">
                  {resolveTab === 'autopilot' && (
                    <ResolveView
                      key={dashboard.workspace.business.id}
                      workspace={dashboard.workspace}
                      resolution={dashboard.resolution}
                      busy={busy}
                      onUpdateLimits={(approvalLimits) =>
                        runAction('Updated distributor-approved limits and re-ran bounded search.', async () => {
                          await api.updateBusinessSettings(dashboard.workspace.business.id, { approvalLimits });
                        })
                      }
                      onEvaluateScenario={async (actions) => {
                        const res = await api.evaluateScenario(dashboard.workspace.business.id, horizonDays, actions);
                        return res.forecast;
                      }}
                      onSaveScenario={(name, scenarioKind, actions) =>
                        runAction(`Saved isolated what-if scenario "${name}".`, async () => {
                          await api.saveScenario(dashboard.workspace.business.id, { name, scenarioKind, horizonDays, actions });
                        })
                      }
                      onProposePlan={handleProposePlan}
                      onSimulateInWhatIf={(scenario) => {
                        setTransferredScenario(scenario);
                        setResolveTab('what-if');
                      }}
                    />
                  )}

                  {resolveTab === 'what-if' && (
                    <WhatIfControlRoom
                      workspace={dashboard.workspace}
                      horizonDays={horizonDays}
                      initialScenario={transferredScenario}
                      onClearInitialScenario={() => setTransferredScenario(null)}
                      onJumpToResolve={() => setResolveTab('autopilot')}
                      onEvaluateScenario={async (actions) => {
                        const res = await api.evaluateScenario(dashboard.workspace.business.id, horizonDays, actions);
                        return res.forecast;
                      }}
                      onSaveScenario={(name, scenarioKind, actions) =>
                        runAction(`Saved isolated what-if scenario "${name}".`, async () => {
                          await api.saveScenario(dashboard.workspace.business.id, { name, scenarioKind, horizonDays, actions });
                        })
                      }
                    />
                  )}

                  {resolveTab === 'commitments' && (
                    <CommitmentsView
                      workspace={dashboard.workspace}
                      verification={dashboard.verification}
                      busy={busy}
                      onCreateBlueprintPlanAProposals={handleCreateBlueprintPlanAProposals}
                      onRecordReply={(commitmentId, payload) =>
                        runAction(`Recorded human decision (${payload.decision}) and updated forecast.`, async () => {
                          await api.recordCommitmentReply(dashboard.workspace.business.id, commitmentId, payload);
                        })
                      }
                    />
                  )}
                </div>
              </>
            )}

            {/* ════════════ 4. TRANSACTIONS ════════════ */}
            {primarySection === 'transactions' && (
              <>
                <div className="subnav-bar">
                  <button
                    className={`subnav-pill ${transactionsTab === 'ledgers' ? 'active' : ''}`}
                    onClick={() => setTransactionsTab('ledgers')}
                  >
                    📋 Invoices & Bills
                  </button>
                  <button
                    className={`subnav-pill ${transactionsTab === 'payments' ? 'active' : ''}`}
                    onClick={() => setTransactionsTab('payments')}
                  >
                    💳 Payments & Reconcile
                  </button>
                  <button
                    className={`subnav-pill ${transactionsTab === 'verify' ? 'active' : ''}`}
                    onClick={() => setTransactionsTab('verify')}
                  >
                    🔍 Verify & Radar
                  </button>
                </div>

                <div className="page-body">
                  {transactionsTab === 'ledgers' && (
                    <LedgersView
                      key={dashboard.workspace.business.id}
                      workspace={dashboard.workspace}
                      busy={busy}
                      onUpdateBusinessSettings={(patch) =>
                        runAction('Updated business cash setup and recalculated forecast.', async () => {
                          await api.updateBusinessSettings(dashboard.workspace.business.id, patch);
                        })
                      }
                      onCreateInvoice={(body) =>
                        runAction(`Added invoice ${body.invoiceNumber}.`, async () => {
                          await api.createInvoice(dashboard.workspace.business.id, body);
                        })
                      }
                      onToggleInvoiceEvidence={(invoiceId, evidenceStatus) =>
                        runAction(`Updated invoice evidence status to ${evidenceStatus}.`, async () => {
                          await api.updateInvoiceEvidence(dashboard.workspace.business.id, invoiceId, evidenceStatus);
                        })
                      }
                      onCreateBill={(body) =>
                        runAction(`Added supplier bill ${body.billNumber}.`, async () => {
                          await api.createBill(dashboard.workspace.business.id, body);
                        })
                      }
                      onCreateExpense={(body) =>
                        runAction(`Added operating expense ${body.expenseCode}.`, async () => {
                          await api.createExpense(dashboard.workspace.business.id, body);
                        })
                      }
                    />
                  )}

                  {transactionsTab === 'payments' && (
                    <PaymentsView
                      workspace={dashboard.workspace}
                      busy={busy}
                      onCreateRetailer={(body) =>
                        runAction(`Registered retailer ${body.retailerCode}.`, async () => {
                          await api.createRetailer(dashboard.workspace.business.id, body);
                        })
                      }
                      onRegisterIdentifier={(retailerId, body) =>
                        runAction(`Verified & hashed identifier (${body.identifierType}).`, async () => {
                          await api.registerIdentifier(dashboard.workspace.business.id, retailerId, body);
                        })
                      }
                      onRecordManualPayment={async (body) => {
                        let outcome = { inserted: false, duplicate: false };
                        const ok = await runActionResult('Processed manual demo payment.', async () => {
                          const res = await api.recordManualPayment(dashboard.workspace.business.id, body);
                          outcome = { inserted: res.inserted, duplicate: res.duplicate };
                        });
                        return { ...outcome, ok };
                      }}
                      onImportCsv={async (filename, csvText) => {
                        let summaryOut = { totalRows: 0, insertedRows: 0, duplicateRows: 0, errorRows: 0 };
                        const ok = await runActionResult(`Processed CSV batch (${filename}).`, async () => {
                          const res = await api.importBankCsv(dashboard.workspace.business.id, filename, csvText);
                          summaryOut = res.summary;
                        });
                        return { ...summaryOut, ok };
                      }}
                      onManualMatch={(paymentId, retailerId, note) =>
                        runAction('Confirmed manual retailer match.', async () => {
                          await api.manualMatchPayment(dashboard.workspace.business.id, paymentId, retailerId, note);
                        })
                      }
                      onLoadAllocationPreview={(paymentId) =>
                        api.previewAllocation(dashboard.workspace.business.id, paymentId)
                      }
                      onConfirmAllocation={(paymentId, allocations) =>
                        runActionResult('Applied payment allocation atomically in PostgreSQL transaction.', async () => {
                          await api.confirmAllocation(dashboard.workspace.business.id, paymentId, allocations);
                        })
                      }
                      onReversePayment={(paymentId, reason) =>
                        runAction('Recorded non-destructive payment reversal & restored balances.', async () => {
                          await api.reversePayment(dashboard.workspace.business.id, paymentId, reason);
                        })
                      }
                    />
                  )}

                  {transactionsTab === 'verify' && (
                    <VerifyView
                      key={dashboard.workspace.business.id}
                      workspace={dashboard.workspace}
                      verification={dashboard.verification}
                      busy={busy}
                      onSimulateDelayRadar={async (delays, asOfDate) => {
                        const res = await api.runVerificationRadar(
                          dashboard.workspace.business.id,
                          Math.max(horizonDays, 16),
                          delays,
                          asOfDate,
                        );
                        return res.verification;
                      }}
                      onReconcileCommitments={async (options) => {
                        const res = await api.reconcileCommitments(dashboard.workspace.business.id, options);
                        await refreshDashboard();
                        return res;
                      }}
                    />
                  )}
                </div>
              </>
            )}

            {/* ════════════ 5. INSIGHTS & REPORTS ════════════ */}
            {primarySection === 'insights' && (
              <>
                <div className="subnav-bar">
                  <button
                    className={`subnav-pill ${insightsTab === 'risk' ? 'active' : ''}`}
                    onClick={() => setInsightsTab('risk')}
                  >
                    🎯 Retailer Risk Radar
                  </button>
                  <button
                    className={`subnav-pill ${insightsTab === 'retailers' ? 'active' : ''}`}
                    onClick={() => setInsightsTab('retailers')}
                  >
                    🏪 Retailer Directory
                  </button>
                  <button
                    className={`subnav-pill ${insightsTab === 'agreements' ? 'active' : ''}`}
                    onClick={() => setInsightsTab('agreements')}
                  >
                    📜 Credit Agreements
                  </button>
                  <button
                    className={`subnav-pill ${insightsTab === 'negotiations' ? 'active' : ''}`}
                    onClick={() => setInsightsTab('negotiations')}
                  >
                    💬 Payment Negotiations
                  </button>
                </div>

                <div className="page-body">
                  {insightsTab === 'risk' && (
                    <RetailerRiskView businessId={dashboard.workspace.business.id} />
                  )}

                  {insightsTab === 'retailers' && (
                    <RetailersView
                      workspace={dashboard.workspace}
                      businessId={dashboard.workspace.business.id}
                      busy={busy}
                      onRefreshWorkspace={() => void loadBusinessesAndDashboard()}
                      onNavigateToCommunications={(retId) => {
                        setTargetContactForChat(retId);
                        handleNavigate('communications');
                      }}
                    />
                  )}

                  {insightsTab === 'agreements' && (
                    <CreditAgreementsView
                      workspace={dashboard.workspace}
                      businessId={dashboard.workspace.business.id}
                    />
                  )}

                  {insightsTab === 'negotiations' && (
                    <NegotiationsView
                      workspace={dashboard.workspace}
                      businessId={dashboard.workspace.business.id}
                      onRefreshWorkspace={async () => void loadBusinessesAndDashboard()}
                    />
                  )}
                </div>
              </>
            )}

            {/* ════════════ 6. COMMUNICATION & SETTINGS ════════════ */}
            {primarySection === 'settings' && (
              <>
                <div className="subnav-bar">
                  <button
                    className={`subnav-pill ${settingsTab === 'communications' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('communications')}
                  >
                    ✉️ Communications Centre
                  </button>
                  <button
                    className={`subnav-pill ${settingsTab === 'automation' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('automation')}
                  >
                    ⚡ Automation Centre
                  </button>
                  <button
                    className={`subnav-pill ${settingsTab === 'business-settings' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('business-settings')}
                  >
                    ⚙️ Business Settings & Liquidity
                  </button>
                </div>

                <div className="page-body">
                  {settingsTab === 'communications' && (
                    <CommunicationsView
                      workspace={dashboard.workspace}
                      businessId={dashboard.workspace.business.id}
                      initialContactId={targetContactForChat}
                    />
                  )}

                  {settingsTab === 'automation' && (
                    <AutomationView businessId={dashboard.workspace.business.id} />
                  )}

                  {settingsTab === 'business-settings' && (
                    <BusinessSettingsView
                      business={dashboard.workspace.business}
                      busy={busy}
                      onUpdateSettings={(patch) =>
                        runAction('Updated business cash setup and recalculated forecast.', async () => {
                          await api.updateBusinessSettings(dashboard.workspace.business.id, patch);
                        })
                      }
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* Smart Exit Modal */}
      {showExitModal && dashboard && (
        <SmartExitModal
          workspace={dashboard.workspace}
          onStay={() => setShowExitModal(false)}
          onConfirmExit={handleExitLogout}
        />
      )}
    </div>
  );
}
