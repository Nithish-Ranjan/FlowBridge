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
import { ForecastView } from './components/ForecastView';
import { ResolveView } from './components/ResolveView';
import { CommitmentsView } from './components/CommitmentsView';
import { VerifyView } from './components/VerifyView';
import { PaymentsView } from './components/PaymentsView';
import { LedgersView } from './components/LedgersView';
import { EmergencyReserveView } from './components/EmergencyReserveView';
import { CreditAgreementsView } from './components/CreditAgreementsView';
import { NegotiationsView } from './components/NegotiationsView';
import { RetailerRiskView } from './components/RetailerRiskView';
import { CommunicationsView } from './components/CommunicationsView';
import { AutomationView } from './components/AutomationView';
import { DailyPlanView } from './components/DailyPlanView';
import { SmartExitModal } from './components/SmartExitModal';
import { AuthView } from './components/AuthView';
import { LandingPage } from './components/LandingPage';
import { OnboardingModal } from './components/OnboardingModal';
import { DashboardView } from './components/DashboardView';
import { WhatIfControlRoom } from './components/WhatIfControlRoom';
import { RetailersView } from './components/RetailersView';

export interface TransferredScenario {
  title: string;
  subtitle?: string;
  source: 'RESOLUTION_AUTOPILOT' | 'PRESET' | 'NATURAL_LANGUAGE' | 'CUSTOM';
  actions: ScenarioActionInput[];
  planId?: string;
  notes?: string;
  expectedOutcome?: string;
}

type PageKey =
  | 'overview'
  | 'what-if'
  | 'forecast'
  | 'resolve'
  | 'reserve'
  | 'retailers'
  | 'agreements'
  | 'negotiations'
  | 'risk'
  | 'commitments'
  | 'verify'
  | 'payments'
  | 'ledgers'
  | 'communications'
  | 'automation'
  | 'reports';

interface NavItem {
  key: PageKey;
  label: string;
  icon: string;
  section: string;
}

const NAV_ITEMS: NavItem[] = [
  // Overview & Intelligence
  { key: 'overview', label: 'Dashboard', icon: '⬡', section: 'Overview' },
  { key: 'what-if', label: 'What-If Control Room', icon: '🎛️', section: 'Overview' },
  { key: 'reports', label: 'Daily Financial Plan', icon: '🎙️', section: 'Overview' },
  // Financial Management
  { key: 'forecast', label: 'Cash Forecast', icon: '📈', section: 'Financial Management' },
  { key: 'resolve', label: 'Resolution Autopilot', icon: '🧩', section: 'Financial Management' },
  { key: 'reserve', label: 'Emergency Reserve', icon: '🛡️', section: 'Financial Management' },
  // Business Operations
  { key: 'retailers', label: 'Retailer Management', icon: '🏪', section: 'Business Operations' },
  { key: 'agreements', label: 'Credit Agreements', icon: '📜', section: 'Business Operations' },
  { key: 'negotiations', label: 'Payment Negotiations', icon: '💬', section: 'Business Operations' },
  { key: 'risk', label: 'Retailer Risk Radar', icon: '🎯', section: 'Business Operations' },
  { key: 'commitments', label: 'Track Commitments', icon: '🤝', section: 'Business Operations' },
  { key: 'verify', label: 'Verify & Radar', icon: '🔍', section: 'Business Operations' },
  { key: 'payments', label: 'Payments & Reconcile', icon: '💳', section: 'Business Operations' },
  { key: 'ledgers', label: 'Invoices & Ledgers', icon: '📋', section: 'Business Operations' },
  // Communication & Automation
  { key: 'communications', label: 'Communications Centre', icon: '✉️', section: 'Communication & Automation' },
  { key: 'automation', label: 'Automation Centre', icon: '⚡', section: 'Communication & Automation' },
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
  const [activePage, setActivePage] = useState<PageKey>('overview');
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
    const custAInv = dashboard.workspace.invoices.find((i) => i.invoiceNumber === 'C-3301');
    const supABill = dashboard.workspace.bills.find((b) => b.billNumber === 'S-2041');
    if (!custAInv || !supABill) {
      setError('Blueprint records C-3301 or S-2041 not found in workspace.');
      return;
    }
    const day4 = addDays(dashboard.workspace.business.openingCashDate, 4);
    const day12 = addDays(dashboard.workspace.business.openingCashDate, 12);
    await runAction('Created Blueprint Plan A Proposals (Customer A ₹20,000 & Supplier A ₹38,000).', async () => {
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

  const sections = Array.from(new Set(NAV_ITEMS.map((item) => item.section)));

  return (
    <div className="app-shell">
      {/* ── TOP HEADER BAR ── */}
      <header
        style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
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
          {/* User badge */}
          {currentUser && (
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              👤 {currentUser.fullName} ({currentUser.role})
            </span>
          )}

          {/* Smart Exit / Logout */}
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

      {/* ── COMPACT SIDEBAR ────────────────── */}
      <aside className="sidebar" style={{ overflowY: 'auto' }}>
        <nav className="nav-list">
          {sections.map((section) => (
            <div key={section} style={{ marginBottom: 14 }}>
              <div
                style={{
                  padding: '4px 10px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  letterSpacing: '0.5px',
                }}
              >
                {section}
              </div>
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${activePage === item.key ? 'active' : ''}`}
                  onClick={() => setActivePage(item.key)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
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
                padding: '5px 8px',
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
              padding: '5px 8px',
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

      {/* ── MAIN CONTENT ─────────────────────── */}
      <main className="main-content">
        {error && (
          <div className="banner banner-error" style={{ margin: '14px 24px 0' }}>
            <div><strong>Error:</strong> {error}</div>
            <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {notice && (
          <div className="banner banner-success" style={{ margin: '14px 24px 0' }}>
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
            <p className="muted">
              Ensure PostgreSQL is running and seed is applied.
            </p>
          </div>
        )}

        {!loading && dashboard && (
          <>
            {activePage === 'overview' && (
              <div className="page-body">
                <DashboardView
                  dashboard={dashboard}
                  busy={busy}
                  onNavigate={setActivePage}
                  onRefresh={() => void loadBusinessesAndDashboard()}
                />
              </div>
            )}
            {activePage === 'what-if' && (
              <div className="page-body">
                <WhatIfControlRoom
                  workspace={dashboard.workspace}
                  horizonDays={horizonDays}
                  initialScenario={transferredScenario}
                  onClearInitialScenario={() => setTransferredScenario(null)}
                  onJumpToResolve={() => setActivePage('resolve')}
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
              </div>
            )}
            {activePage === 'retailers' && (
              <div className="page-body">
                <RetailersView
                  workspace={dashboard.workspace}
                  businessId={dashboard.workspace.business.id}
                  busy={busy}
                  onRefreshWorkspace={() => void loadBusinessesAndDashboard()}
                  onNavigateToCommunications={(retId) => {
                    setTargetContactForChat(retId);
                    setActivePage('communications');
                  }}
                />
              </div>
            )}
            {activePage === 'reports' && (
              <div className="page-body">
                <DailyPlanView businessId={dashboard.workspace.business.id} />
              </div>
            )}
            {activePage === 'forecast' && (
              <div className="page-body">
                <ForecastView
                  workspace={dashboard.workspace}
                  forecast={dashboard.forecast}
                  busy={busy}
                  onJumpToResolve={() => setActivePage('resolve')}
                  onSaveSnapshot={(label) =>
                    runAction(`Saved forecast snapshot "${label}".`, async () => {
                      await api.saveForecastSnapshot(dashboard.workspace.business.id, horizonDays, label);
                    })
                  }
                />
              </div>
            )}
            {activePage === 'resolve' && (
              <div className="page-body">
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
                    setActivePage('what-if');
                  }}
                />
              </div>
            )}
            {activePage === 'reserve' && (
              <div className="page-body">
                <EmergencyReserveView businessId={dashboard.workspace.business.id} />
              </div>
            )}
            {activePage === 'agreements' && (
              <div className="page-body">
                <CreditAgreementsView workspace={dashboard.workspace} businessId={dashboard.workspace.business.id} />
              </div>
            )}
            {activePage === 'negotiations' && (
              <div className="page-body">
                <NegotiationsView
                  workspace={dashboard.workspace}
                  businessId={dashboard.workspace.business.id}
                  onRefreshWorkspace={async () => void loadBusinessesAndDashboard()}
                />
              </div>
            )}
            {activePage === 'risk' && (
              <div className="page-body">
                <RetailerRiskView businessId={dashboard.workspace.business.id} />
              </div>
            )}
            {activePage === 'commitments' && (
              <div className="page-body">
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
              </div>
            )}
            {activePage === 'verify' && (
              <div className="page-body">
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
              </div>
            )}
            {activePage === 'payments' && (
              <div className="page-body">
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
                  onLoadAllocationPreview={(paymentId) => api.previewAllocation(dashboard.workspace.business.id, paymentId)}
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
              </div>
            )}
            {activePage === 'ledgers' && (
              <div className="page-body">
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
              </div>
            )}
            {activePage === 'communications' && (
              <div className="page-body">
                <CommunicationsView
                  workspace={dashboard.workspace}
                  businessId={dashboard.workspace.business.id}
                  initialContactId={targetContactForChat}
                />
              </div>
            )}
            {activePage === 'automation' && (
              <div className="page-body">
                <AutomationView businessId={dashboard.workspace.business.id} />
              </div>
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

// ── OVERVIEW DASHBOARD PAGE ───────────────────────────────────────────────────

interface OverviewPageProps {
  dashboard: DashboardResponse;
  busy: boolean;
  onNavigate: (page: PageKey) => void;
  onRefresh: () => void;
}

function OverviewPage({ dashboard, busy, onNavigate, onRefresh }: OverviewPageProps) {
  const { workspace, forecast } = dashboard;
  const { business } = workspace;
  const { breach, trustCounters, chasePriorities } = forecast;

  const totalReceivables = workspace.invoices.reduce(
    (sum, inv) => sum + parsePaise(inv.outstandingPaise || '0'),
    0n,
  );
  const totalPayables = [...workspace.bills, ...workspace.expenses].reduce(
    (sum, item) => sum + parsePaise(item.outstandingPaise || '0'),
    0n,
  );
  const unmatchedCount = workspace.transactions.filter(
    (t) => t.matchStatus === 'UNMATCHED' || t.matchStatus === 'AMBIGUOUS',
  ).length;
  const atRiskCount = workspace.commitments.filter(
    (c) => c.status === 'AT_RISK' || c.status === 'FAILED',
  ).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview Command Centre</h1>
          <p>{business.name} · {business.code} · Day 0: {business.openingCashDate}</p>
        </div>
        <div className="controls-row">
          <button className="btn" disabled={busy} onClick={onRefresh}>🔄 Refresh</button>
          <button className="btn btn-emerald" onClick={() => onNavigate('reports')}>🎙️ Daily Briefing & Plan</button>
          <button className="btn btn-primary" onClick={() => onNavigate('forecast')}>View Forecast →</button>
        </div>
      </div>

      <div className="page-body">
        {/* Morning Briefing Banner */}
        <div
          className={`banner ${breach.firstBreachDate ? 'banner-warn' : 'banner-success'}`}
          style={{ marginBottom: 16 }}
        >
          <div>
            <strong>Morning Briefing Status:</strong>{' '}
            {breach.firstBreachDate ? (
              <>
                Projected cash shortage of{' '}
                <strong>{formatINR(breach.shortfallPaise)}</strong> expected on{' '}
                <strong>{breach.firstBreachDate}</strong> (Day {breach.firstBreachDayIndex}). Emergency reserve
                and resolution autopilot levers are available to resolve this timing gap.
              </>
            ) : (
              'All cash flow projections remain healthy. No cash shortage detected over the current forecast horizon.'
            )}
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => onNavigate(breach.firstBreachDate ? 'resolve' : 'reports')}>
            {breach.firstBreachDate ? 'Open Resolution Autopilot' : 'View Action Plan'}
          </button>
        </div>

        {/* KPI Cards */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Opening Cash (Day 0)</div>
            <div className="kpi-value num">{formatINR(forecast.openingCashPaise)}</div>
            <div className="kpi-foot">Min threshold: {formatINR(forecast.minimumCashPaise)}</div>
          </div>

          <div className="kpi-card good" style={{ cursor: 'pointer' }} onClick={() => onNavigate('reserve')}>
            <div className="kpi-label">Emergency Reserve</div>
            <div className="kpi-value num">₹50,000</div>
            <div className="kpi-foot">Protected last-resort buffer →</div>
          </div>

          <div className="kpi-card good">
            <div className="kpi-label">Total Receivables</div>
            <div className="kpi-value num">{formatINR(totalReceivables.toString())}</div>
            <div className="kpi-foot">{workspace.invoices.filter((i) => i.status !== 'PAID').length} open invoices</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Total Payables</div>
            <div className="kpi-value num">{formatINR(totalPayables.toString())}</div>
            <div className="kpi-foot">{workspace.bills.length} bills + {workspace.expenses.length} expenses</div>
          </div>

          <div className={`kpi-card ${breach.firstBreachDate ? 'danger' : 'good'}`}>
            <div className="kpi-label">First Cash Breach</div>
            <div className="kpi-value num" style={{ fontSize: '1.25rem' }}>
              {breach.firstBreachDate ? `Day ${breach.firstBreachDayIndex} (${breach.firstBreachDate})` : 'None detected'}
            </div>
            <div className="kpi-foot">
              {breach.firstBreachDate
                ? `Shortfall: ${formatINR(breach.shortfallPaise)}`
                : `Lowest: ${formatINR(breach.lowestBalancePaise)}`}
            </div>
          </div>

          <div className={`kpi-card ${trustCounters.trustRatioPct < 80 ? 'danger' : ''}`}>
            <div className="kpi-label">Forecast Trust Score</div>
            <div className="kpi-value num">{trustCounters.trustRatioPct}%</div>
            <div className="kpi-foot">
              {trustCounters.actualCount} verified / {trustCounters.totalRecords} records
            </div>
          </div>
        </div>

        {/* Priority Chase Table */}
        {chasePriorities.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div>
                <h3>Collection Priority Radar</h3>
                <div className="muted">Ranked by urgency bonus, evidence strength, and rupee amount</div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => onNavigate('forecast')}>
                Interactive Timeline →
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Retailer</th>
                    <th>Due</th>
                    <th>Outstanding</th>
                    <th>Evidence</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {chasePriorities.slice(0, 8).map((c) => (
                    <tr key={c.invoiceId}>
                      <td><span className="code-pill">{c.invoiceNumber}</span></td>
                      <td>{c.retailerName}</td>
                      <td className="num">{c.dueDate}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--rose)' }}>{formatINR(c.outstandingPaise)}</td>
                      <td><span className="badge badge-warn">{c.evidenceStatus}</span></td>
                      <td className="muted" style={{ fontSize: '0.78rem' }}>{c.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {chasePriorities.length > 8 && (
              <button className="btn" style={{ marginTop: 10 }} onClick={() => onNavigate('forecast')}>
                View all {chasePriorities.length} →
              </button>
            )}
          </div>
        )}

        {/* Recent Transactions */}
        {workspace.transactions.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3>Recent Payment Activity</h3>
              <button className="btn btn-sm" onClick={() => onNavigate('payments')}>View All →</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Match Status</th>
                    <th>Retailer</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.transactions.slice(0, 6).map((tx) => (
                    <tr key={tx.id}>
                      <td className="num">{tx.valueDate}</td>
                      <td><span className="badge badge-neutral">{tx.paymentMethod}</span></td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--teal)' }}>{formatINR(tx.amountPaise)}</td>
                      <td>
                        <span className={`badge ${tx.matchStatus === 'MATCHED' ? 'badge-actual' : tx.matchStatus === 'AMBIGUOUS' ? 'badge-warn' : 'badge-danger'}`}>
                          {tx.matchStatus}
                        </span>
                      </td>
                      <td>{tx.matchedRetailerCode ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Core Product Workflow */}
        <div className="card">
          <div className="card-header">
            <h3>FlowBridge Operating Workflow Pipeline</h3>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { stage: '1', label: 'PREDICT', desc: `${forecast.horizonDays}-day cash schedule`, ok: true, page: 'forecast' as PageKey },
              { stage: '2', label: 'EXPLAIN', desc: breach.firstBreachDate ? `Gap on Day ${breach.firstBreachDayIndex}` : 'No breach detected', ok: !breach.firstBreachDate, page: 'forecast' as PageKey },
              { stage: '3', label: 'RESOLVE', desc: 'Bounded autopilot plans', ok: true, page: 'resolve' as PageKey },
              { stage: '4', label: 'PROTECT', desc: 'Ring-fenced emergency reserve', ok: true, page: 'reserve' as PageKey },
              { stage: '5', label: 'TRACK', desc: `${workspace.commitments.length} commitments tracked`, ok: atRiskCount === 0, page: 'commitments' as PageKey },
              { stage: '6', label: 'VERIFY', desc: `${trustCounters.actualCount} verified actual inflows`, ok: unmatchedCount === 0, page: 'verify' as PageKey },
              { stage: '7', label: 'COMMUNICATE', desc: 'Email & WhatsApp dispatch', ok: true, page: 'communications' as PageKey },
              { stage: '8', label: 'AUTOMATE', desc: 'Event-driven rules engine', ok: true, page: 'automation' as PageKey },
            ].map((s) => (
              <div
                key={s.stage}
                onClick={() => onNavigate(s.page)}
                style={{
                  flex: '1',
                  minWidth: 120,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${s.ok ? 'var(--teal)' : 'var(--amber)'}`,
                  background: s.ok ? 'var(--teal-soft)' : 'var(--amber-soft)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span className="code-pill">Step {s.stage}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.78rem', color: s.ok ? 'var(--teal)' : 'var(--amber)' }}>
                    {s.label}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
