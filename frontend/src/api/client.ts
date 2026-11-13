import type {
  ApprovalLimits,
  BusinessDTO,
  CommitmentDTO,
  CustomerInvoiceDTO,
  ForecastResult,
  OperatingExpenseDTO,
  PaymentAllocationDTO,
  PaymentTransactionDTO,
  PromiseRadarReport,
  ResolutionSearchResult,
  RetailerDTO,
  RetailerPaymentIdentifierDTO,
  ScenarioActionInput,
  SupplierBillDTO,
  SupplierDTO,
} from '@flowbridge/shared';

export type {
  RetailerDTO,
  RetailerPaymentIdentifierDTO,
  CustomerInvoiceDTO,
  PaymentTransactionDTO,
  PaymentAllocationDTO,
  SupplierDTO,
  SupplierBillDTO,
  OperatingExpenseDTO,
  CommitmentDTO,
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

export interface WorkspacePayload {
  business: BusinessDTO;
  retailers: RetailerDTO[];
  identifiers: RetailerPaymentIdentifierDTO[];
  suppliers: SupplierDTO[];
  invoices: CustomerInvoiceDTO[];
  bills: SupplierBillDTO[];
  expenses: OperatingExpenseDTO[];
  transactions: PaymentTransactionDTO[];
  allocations: PaymentAllocationDTO[];
  importBatches: Array<{
    id: string;
    sourceType: string;
    filename: string | null;
    importedAt: string;
    status: string;
    totalRows: number;
    insertedRows: number;
    duplicateRows: number;
    errorRows: number;
  }>;
  commitments: CommitmentDTO[];
  scenarios: Array<{
    id: string;
    name: string;
    description: string | null;
    scenarioKind: string;
    asOfDate: string;
    horizonDays: number;
    isFeasible: boolean | null;
    actions: ScenarioActionInput[];
  }>;
  snapshots: Array<{
    id: string;
    snapshotLabel: string | null;
    dataClassification: string;
    asOfDate: string;
    generatedAt: string;
    horizonDays: number;
    firstBreachDate: string | null;
    minimumBalancePaise: string;
  }>;
  auditEvents: Array<{
    id: string;
    eventType: string;
    entityType: string;
    actor: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface VerificationPayload {
  asOfDate: string;
  radar: PromiseRadarReport;
  actualVsPlan: Array<{
    commitmentId: string;
    actionType: string;
    status: string;
    expectedDate: string;
    expectedAmountPaise: string;
    actualFulfilledPaise: string;
    variancePaise: string;
    assessment: string;
  }>;
  totalVerifiedInflowsPaise: string;
  totalPendingReviewInflowsPaise: string;
  negotiationTemplates: Array<{
    targetCode: string;
    counterparty: string;
    channel: 'WHATSAPP' | 'PHONE_SCRIPT';
    templateText: string;
  }>;
}

export interface CommitmentReconciliationResponse {
  asOfDate: string;
  bankDataCompleteThrough: string | null;
  hasPendingUnmatched: boolean;
  commitmentsReconciled: Array<{
    commitmentId: string;
    actionType: string;
    dueDate: string;
    expectedAmountPaise: string;
    fulfilledAmountPaise: string;
    reconciliationStatus: 'MATCHED' | 'PARTIAL' | 'MISSED' | 'UNKNOWN_NEEDS_REVIEW' | 'PENDING_FUTURE';
    explanation: string;
  }>;
  radar: PromiseRadarReport;
}

export interface DashboardResponse {
  workspace: WorkspacePayload;
  forecast: ForecastResult;
  resolution: ResolutionSearchResult;
  verification: VerificationPayload;
}

export interface AllocationPreviewResponse {
  preview: {
    paymentId: string;
    retailerId: string;
    retailerCode: string;
    retailerName: string;
    remainingPaymentPaise: string;
    allocationPolicy: string;
    lines: Array<{
      invoiceId: string;
      invoiceNumber: string;
      dueDate: string;
      currentOutstandingPaise: string;
      proposedAllocatePaise: string;
      postAllocationOutstandingPaise: string;
      allocationMethod: 'EXPLICIT_INVOICE' | 'OLDEST_DUE_FIRST' | 'MANUAL_OVERRIDE';
    }>;
    totalProposedAllocatePaise: string;
    unappliedOverpaymentPaise: string;
    requiresConfirmation: true;
  };
}

interface ApiErrorPayload {
  error?: string | { code?: string; message?: string; details?: Array<{ path?: string; message?: string }> };
  details?: Array<{ path?: string; message?: string }>;
}

const TOKEN_KEY = 'flowbridge_session_token';

export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T & ApiErrorPayload }> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorPayload;
  return { status: res.status, ok: res.ok, data };
}

function formatApiError(status: number, data: ApiErrorPayload): string {
  if (typeof data.error === 'string') {
    const detailMsg = data.details?.map((d) => `${d.path ?? 'field'}: ${d.message ?? ''}`).join('; ');
    return detailMsg ? `${data.error}: ${detailMsg}` : data.error;
  }
  if (data.error && typeof data.error === 'object') {
    const detailsArr = Array.isArray(data.error.details) ? data.error.details : undefined;
    const detailMsg = detailsArr?.map((d) => `${d.path ?? 'field'}: ${d.message ?? ''}`).join('; ');
    const base = data.error.message ?? `HTTP ${status}`;
    return detailMsg ? `${base} (${detailMsg})` : base;
  }
  return `HTTP ${status}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { status, ok, data } = await apiFetchRaw<T>(path, init);
  if (!ok) {
    throw new Error(formatApiError(status, data));
  }
  return data;
}

export const api = {
  health: () => apiFetch<{ ok: boolean; database: string }>('/health'),
  listBusinesses: () => apiFetch<{ businesses: BusinessDTO[] }>('/businesses'),
  createBusiness: (body: {
    code: string;
    name: string;
    openingCashPaise: string;
    openingCashDate: string;
    minimumCashPaise: string;
    allocationPolicy: BusinessDTO['allocationPolicy'];
  }) => apiFetch<{ business: BusinessDTO }>('/businesses', { method: 'POST', body: JSON.stringify(body) }),
  updateBusinessSettings: (
    businessId: string,
    body: {
      openingCashPaise?: string;
      openingCashDate?: string;
      minimumCashPaise?: string;
      allocationPolicy?: BusinessDTO['allocationPolicy'];
      approvalLimits?: ApprovalLimits;
    },
  ) => apiFetch<{ business: BusinessDTO }>(`/business/settings?businessId=${businessId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getDashboard: (businessId: string, horizonDays = 15) =>
    apiFetch<DashboardResponse>(`/businesses/${businessId}/dashboard?horizonDays=${horizonDays}`),
  saveForecastSnapshot: (businessId: string, horizonDays: number, saveSnapshotLabel: string) =>
    apiFetch<{ forecast: ForecastResult }>(`/forecast/recalculate?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ horizonDays, snapshotLabel: saveSnapshotLabel }),
    }),
  evaluateScenario: (businessId: string, horizonDays: number, actions: ScenarioActionInput[]) =>
    apiFetch<{ forecast: ForecastResult }>(`/scenarios/evaluate?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ horizonDays, actions }),
    }),
  saveScenario: (
    businessId: string,
    body: {
      name: string;
      description?: string;
      scenarioKind: 'BASELINE' | 'RESOLUTION_PLAN' | 'SHOCKWAVE_WHAT_IF' | 'EMERGENCY_FALLBACK';
      horizonDays: number;
      actions: ScenarioActionInput[];
    },
  ) => apiFetch(`/scenarios?businessId=${businessId}`, { method: 'POST', body: JSON.stringify(body) }),
  proposeCommitments: (
    businessId: string,
    actions: Array<{
      counterpartyType: 'RETAILER' | 'SUPPLIER' | 'EXPENSE';
      retailerId?: string | null;
      customerInvoiceId?: string | null;
      supplierId?: string | null;
      supplierBillId?: string | null;
      operatingExpenseId?: string | null;
      actionType: CommitmentDTO['actionType'];
      proposedAmountPaise: string;
      proposedDate: string;
    }>,
  ) => apiFetch<{ commitments: CommitmentDTO[] }>(`/commitments?businessId=${businessId}`, {
    method: 'POST',
    body: JSON.stringify({ actions }),
  }),
  recordCommitmentReply: (
    businessId: string,
    commitmentId: string,
    body: {
      decision: 'AGREED' | 'CANCELLED' | 'FAILED' | 'COMPLETED' | 'AT_RISK';
      humanReplyBy: string;
      humanReplyChannel: string;
      humanReplyNotes?: string;
      agreedAmountPaise?: string;
      agreedDate?: string;
    },
  ) =>
    apiFetch<{ commitment: CommitmentDTO }>(`/commitments/${commitmentId}/status?businessId=${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: body.decision,
        humanReplyBy: body.humanReplyBy,
        humanReplyChannel: body.humanReplyChannel,
        humanReplyNotes: body.humanReplyNotes,
        agreedAmountPaise: body.agreedAmountPaise,
        agreedDate: body.agreedDate,
      }),
    }),
  runVerificationRadar: (
    businessId: string,
    horizonDays: number,
    simulatedDelays: Array<{ invoiceId: string; delayDays: number }>,
    asOfDate?: string,
  ) =>
    apiFetch<{ verification: VerificationPayload }>(`/risk/promise-failure-radar?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ horizonDays, simulatedDelays, ...(asOfDate ? { asOfDate } : {}) }),
    }),
  createRetailer: (
    businessId: string,
    body: {
      retailerCode: string;
      name: string;
      contactName?: string;
      phoneMasked?: string;
      email?: string;
      creditTermsDays?: number;
      reliabilityScore?: number;
      notes?: string;
    },
  ) => apiFetch<{ retailer: RetailerDTO }>(`/retailers?businessId=${businessId}`, { method: 'POST', body: JSON.stringify(body) }),
  getRetailerPaymentHistory: (businessId: string, retailerId: string) =>
    apiFetch<{
      retailer: RetailerDTO;
      payments: PaymentTransactionDTO[];
      allocations: PaymentAllocationDTO[];
      creditEvents: any[];
    }>(`/retailers/${retailerId}/payment-history?businessId=${businessId}`),
  registerIdentifier: (
    businessId: string,
    retailerId: string,
    body: { identifierType: 'UPI_ID' | 'BANK_ACCOUNT'; rawValue: string; displayLabel: string },
  ) =>
    apiFetch(`/retailers/${retailerId}/payment-identifiers?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  recordManualPayment: async (
    businessId: string,
    body: {
      direction: 'INFLOW' | 'OUTFLOW';
      paymentMethod: 'UPI' | 'BANK_TRANSFER' | 'OTHER';
      externalTransactionReference?: string;
      explicitInvoiceReference?: string;
      payerIdentifierType?: 'UPI_ID' | 'BANK_ACCOUNT';
      payerIdentifierRaw?: string;
      payerDisplayName?: string;
      narration: string;
      amountPaise: string;
      transactionTimestamp: string;
      valueDate: string;
    },
  ): Promise<{ inserted: boolean; duplicate: boolean; transaction: PaymentTransactionDTO | null }> => {
    const { status, ok, data } = await apiFetchRaw<{ transaction?: PaymentTransactionDTO }>(
      `/payments/manual?businessId=${businessId}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (status === 409) {
      return { inserted: false, duplicate: true, transaction: null };
    }
    if (!ok) {
      throw new Error(formatApiError(status, data));
    }
    return { inserted: true, duplicate: false, transaction: data.transaction ?? null };
  },
  importBankCsv: async (businessId: string, filename: string, csvText: string) => {
    const summary = await apiFetch<{
      batchId: string;
      totalRows: number;
      insertedRows: number;
      duplicateRows: number;
      errorRows: number;
      errors: Array<{ rowNumber: number; message: string }>;
    }>(`/imports/bank-transactions?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ filename, csvText }),
    });
    return { summary };
  },
  manualMatchPayment: (businessId: string, paymentId: string, retailerId: string, note: string) =>
    apiFetch(`/payments/${paymentId}/resolve-match?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ retailerId, note }),
    }),
  previewAllocation: (businessId: string, paymentId: string) =>
    apiFetch<AllocationPreviewResponse>(`/payments/${paymentId}/allocation-preview?businessId=${businessId}`),
  confirmAllocation: (
    businessId: string,
    paymentId: string,
    allocations: Array<{
      invoiceId: string;
      amountPaise: string;
      allocationMethod: 'EXPLICIT_INVOICE' | 'OLDEST_DUE_FIRST' | 'MANUAL_OVERRIDE';
    }>,
  ) =>
    apiFetch(`/payments/${paymentId}/allocate?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ allocations, creditRemainderAsOverpayment: true }),
    }),
  reversePayment: (businessId: string, paymentId: string, reason: string) =>
    apiFetch(`/payments/${paymentId}/reverse?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  createInvoice: (
    businessId: string,
    body: {
      retailerId: string;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string;
      totalAmountPaise: string;
      evidenceStatus: 'UNCONFIRMED' | 'CONFIRMED_PROMISE' | 'DISPUTED';
    },
  ) => apiFetch(`/invoices?businessId=${businessId}`, { method: 'POST', body: JSON.stringify(body) }),
  updateInvoiceEvidence: (
    businessId: string,
    invoiceId: string,
    evidenceStatus: 'UNCONFIRMED' | 'CONFIRMED_PROMISE' | 'DISPUTED',
  ) =>
    apiFetch(`/invoices/${invoiceId}?businessId=${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ evidenceStatus }),
    }),
  createBill: (
    businessId: string,
    body: {
      supplierId: string;
      billNumber: string;
      issueDate: string;
      dueDate: string;
      totalAmountPaise: string;
      priorityTier: 'ESSENTIAL' | 'NORMAL' | 'FLEXIBLE';
    },
  ) => apiFetch(`/supplier-bills?businessId=${businessId}`, { method: 'POST', body: JSON.stringify(body) }),
  createExpense: (
    businessId: string,
    body: {
      expenseCode: string;
      category: string;
      description: string;
      dueDate: string;
      amountPaise: string;
      priorityTier: 'ESSENTIAL' | 'NORMAL' | 'DEFERRABLE';
      isProtected: boolean;
    },
  ) => apiFetch(`/expenses?businessId=${businessId}`, { method: 'POST', body: JSON.stringify(body) }),

  // Dashboard summary (lighter endpoint)
  getDashboardSummary: (businessId: string, horizonDays = 15) =>
    apiFetch<{
      cashTodayPaise: string;
      totalReceivablesPaise: string;
      totalPayablesPaise: string;
      firstBreachDate: string | null;
      shortfallPaise: string;
      unmatchedPaymentCount: number;
      commitmentsAtRiskCount: number;
      business: BusinessDTO;
      trustCounters: { trustRatioPct: number; actualCount: number; unconfirmedExpectedCount: number; unmatchedOrAmbiguousPayments: number };
    }>(`/dashboard/summary?businessId=${businessId}&horizonDays=${horizonDays}`),

  // Retailers
  listRetailers: (businessId: string) =>
    apiFetch<{ retailers: RetailerDTO[] }>(`/retailers?businessId=${businessId}`),
  getRetailer: (businessId: string, retailerId: string) =>
    apiFetch<{ retailer: RetailerDTO; identifiers: RetailerPaymentIdentifierDTO[] }>(`/retailers/${retailerId}?businessId=${businessId}`),
  updateRetailer: (businessId: string, retailerId: string, body: { name?: string; contactName?: string; creditTermsDays?: number; status?: string }) =>
    apiFetch<{ retailer: RetailerDTO }>(`/retailers/${retailerId}?businessId=${businessId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getRetailerLedger: (businessId: string, retailerId: string) =>
    apiFetch<{
      retailer: RetailerDTO;
      invoices: CustomerInvoiceDTO[];
      allocatedReceipts: PaymentAllocationDTO[];
      totalInvoicedPaise: string;
      totalCollectedPaise: string;
      outstandingBalancePaise: string;
      unappliedCreditPaise: string;
    }>(`/retailers/${retailerId}/ledger?businessId=${businessId}`),

  // Invoices
  listInvoices: (businessId: string) =>
    apiFetch<{ invoices: CustomerInvoiceDTO[] }>(`/invoices?businessId=${businessId}`),
  getInvoice: (businessId: string, id: string) =>
    apiFetch<{ invoice: CustomerInvoiceDTO; allocations: PaymentAllocationDTO[] }>(`/invoices/${id}?businessId=${businessId}`),
  getChasePriority: (businessId: string, beforeDate?: string) =>
    apiFetch<{ invoices: Array<{ invoiceId: string; invoiceNumber: string; retailerName: string; dueDate: string; outstandingPaise: string; evidenceStatus: string; rationale: string }> }>(
      `/invoices/chase-priority?businessId=${businessId}${beforeDate ? '&beforeDate=' + beforeDate : ''}`
    ),

  // Suppliers
  listSuppliers: (businessId: string) =>
    apiFetch<{ suppliers: SupplierDTO[] }>(`/suppliers?businessId=${businessId}`),
  createSupplier: (businessId: string, body: { supplierCode: string; name: string; contactName?: string; paymentTermsDays?: number }) =>
    apiFetch<{ supplier: SupplierDTO }>(`/suppliers?businessId=${businessId}`, { method: 'POST', body: JSON.stringify(body) }),

  // Bills & Expenses
  listBills: (businessId: string) =>
    apiFetch<{ bills: SupplierBillDTO[] }>(`/supplier-bills?businessId=${businessId}`),
  listExpenses: (businessId: string) =>
    apiFetch<{ expenses: OperatingExpenseDTO[] }>(`/expenses?businessId=${businessId}`),

  // Payments
  listPayments: (businessId: string, filters?: { matchStatus?: string; allocationStatus?: string }) => {
    const qs = new URLSearchParams({ businessId });
    if (filters?.matchStatus) qs.set('matchStatus', filters.matchStatus);
    if (filters?.allocationStatus) qs.set('allocationStatus', filters.allocationStatus);
    return apiFetch<{ payments: PaymentTransactionDTO[] }>(`/payments?${qs.toString()}`);
  },
  getMatchQueue: (businessId: string) =>
    apiFetch<{ queue: PaymentTransactionDTO[]; total: number }>(`/payments/match-queue?businessId=${businessId}`),
  getPayment: (businessId: string, paymentId: string) =>
    apiFetch<{ payment: PaymentTransactionDTO; allocations: PaymentAllocationDTO[]; allocationPreview?: AllocationPreviewResponse['preview'] }>(`/payments/${paymentId}?businessId=${businessId}`),

  // Resolution
  runResolution: (businessId: string, horizonDays = 15) =>
    apiFetch<{ resolution: ResolutionSearchResult }>(`/resolution/run?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ horizonDays }),
    }),
  updateResolutionLimits: (businessId: string, limits: ApprovalLimits) =>
    apiFetch<{ business: BusinessDTO }>(`/resolution/limits?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify(limits),
    }),

  // Scenarios
  listScenarios: (businessId: string) =>
    apiFetch<{ scenarios: Array<{ id: string; name: string; description: string | null; scenarioKind: string; asOfDate: string; horizonDays: number; isFeasible: boolean | null; actions: ScenarioActionInput[] }> }>(`/scenarios?businessId=${businessId}`),
  runScenario: (businessId: string, scenarioId: string) =>
    apiFetch<{ scenario: unknown; forecast: ForecastResult }>(`/scenarios/${scenarioId}/run?businessId=${businessId}`, { method: 'POST' }),

  // Commitments
  listCommitments: (businessId: string) =>
    apiFetch<{ commitments: CommitmentDTO[] }>(`/commitments?businessId=${businessId}`),

  // Risk / Verification
  getVerificationRadar: (businessId: string) =>
    apiFetch<{ verification: VerificationPayload }>(`/risk/promise-failure-radar?businessId=${businessId}`),
  reconcileCommitments: (
    businessId: string,
    options?: { asOfDate?: string; assumeBankDataComplete?: boolean },
  ) =>
    apiFetch<CommitmentReconciliationResponse>(`/verification/reconcile?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),

  // Forecast
  getForecast: (businessId: string, horizonDays = 15) =>
    apiFetch<{ forecast: ForecastResult; dataQualityWarnings: string[] }>(`/forecast?businessId=${businessId}&horizonDays=${horizonDays}`),
  recalculateForecast: (businessId: string, horizonDays: number, snapshotLabel?: string) =>
    apiFetch<{ forecast: ForecastResult }>(`/forecast/recalculate?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ horizonDays, snapshotLabel }),
    }),

  // Auth
  login: (input: { email: string; password: string }) =>
    apiFetch<{ token: string; user: any; expiresAt: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  demoLogin: () =>
    apiFetch<{ token: string; user: any; expiresAt: string }>('/auth/demo-login', {
      method: 'POST',
    }),
  register: (input: { email: string; password: string; fullName: string; businessName: string; languagePreference?: string }) =>
    apiFetch<{ token: string; user: any; expiresAt: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getMe: () => apiFetch<{ user: any }>('/auth/me'),
  logout: () => apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  updatePreferences: (languagePreference: string) =>
    apiFetch<{ ok: boolean; user: any }>('/auth/preferences', {
      method: 'POST',
      body: JSON.stringify({ languagePreference }),
    }),

  // Emergency Reserve
  getReserveStatus: (businessId: string) =>
    apiFetch<{ reserve: any; recentMovements: any[] }>(`/reserve?businessId=${businessId}`),
  depositToReserve: (businessId: string, amountPaise: string, reason?: string) =>
    apiFetch<any>(`/reserve/deposit?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ amountPaise, reason }),
    }),
  withdrawFromReserve: (businessId: string, amountPaise: string, reason: string) =>
    apiFetch<any>(`/reserve/withdraw?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ amountPaise, reason }),
    }),
  updateReserveSettings: (businessId: string, targetReservePaise: string, minimumThresholdPaise: string) =>
    apiFetch<any>(`/reserve/settings?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ targetReservePaise, minimumThresholdPaise }),
    }),

  // Credit Agreements
  listCreditAgreements: (businessId: string) =>
    apiFetch<any[]>(`/credit-agreements?businessId=${businessId}`),
  createCreditAgreement: (businessId: string, payload: any) =>
    apiFetch<any>(`/credit-agreements?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  checkCreditSale: (businessId: string, retailerId: string, requestedSalePaise: string) =>
    apiFetch<any>(`/credit-agreements/check-sale?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ retailerId, requestedSalePaise }),
    }),

  // Payment Negotiations
  listNegotiations: (businessId: string) =>
    apiFetch<any[]>(`/negotiations?businessId=${businessId}`),
  proposeNegotiation: (businessId: string, payload: any) =>
    apiFetch<any>(`/negotiations/propose?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  counterOfferNegotiation: (businessId: string, negotiationId: string, counterOfferAmountPaise: string, counterOfferDueDate: string, messageText?: string) =>
    apiFetch<any>(`/negotiations/${negotiationId}/counter?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ counterOfferAmountPaise, counterOfferDueDate, messageText }),
    }),
  acceptNegotiation: (businessId: string, negotiationId: string) =>
    apiFetch<any>(`/negotiations/${negotiationId}/accept?businessId=${businessId}`, {
      method: 'POST',
    }),
  rejectNegotiation: (businessId: string, negotiationId: string, reason?: string) =>
    apiFetch<any>(`/negotiations/${negotiationId}/reject?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Retailer Risk Profiles
  getRetailerRiskProfiles: (businessId: string) =>
    apiFetch<any[]>(`/retailers/risk-profiles?businessId=${businessId}`),

  // Communications
  getCommunicationLogs: (businessId: string) =>
    apiFetch<any[]>(`/communications/logs?businessId=${businessId}`),
  sendInvoiceEmail: (businessId: string, invoiceId: string) =>
    apiFetch<any>(`/communications/send-invoice?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ invoiceId, channel: 'EMAIL' }),
    }),
  sendInvoiceWhatsApp: (businessId: string, invoiceId: string) =>
    apiFetch<any>(`/communications/send-invoice?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ invoiceId, channel: 'WHATSAPP' }),
    }),
  sendPaymentReceipt: (businessId: string, paymentId: string, channel: 'EMAIL' | 'WHATSAPP' = 'WHATSAPP') =>
    apiFetch<any>(`/communications/send-receipt?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ paymentId, channel }),
    }),

  // Daily Plan Report
  getDailyPlanReport: (businessId: string) =>
    apiFetch<any>(`/reports/daily-plan?businessId=${businessId}`),

  // Automation
  getAutomationRules: (businessId: string) =>
    apiFetch<any[]>(`/automation/rules?businessId=${businessId}`),
  getAutomationQueue: (businessId: string) =>
    apiFetch<any[]>(`/automation/queue?businessId=${businessId}`),
  approveAutomationQueueItem: (businessId: string, queueId: string, notes?: string) =>
    apiFetch<any>(`/automation/queue/${queueId}/approve?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  rejectAutomationQueueItem: (businessId: string, queueId: string, notes?: string) =>
    apiFetch<any>(`/automation/queue/${queueId}/reject?businessId=${businessId}`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  // Integrations & Distributor Profile
  getBusinessProfile: (businessId: string) =>
    apiFetch<{ profile: any }>(`/business/${businessId}/profile`),
  updateBusinessProfile: (businessId: string, updates: any) =>
    apiFetch<{ profile: any }>(`/business/${businessId}/profile`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  onboardBusiness: (data: any) =>
    apiFetch<{ business: any; user: any }>('/business/onboard', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Real Bank SMS Ingestion
  parseBankSms: (businessId: string, rawSms: string, senderHeader?: string) =>
    apiFetch<{ parsed: any; candidates: any[]; evidence: any }>(`/business/${businessId}/sms/parse-raw`, {
      method: 'POST',
      body: JSON.stringify({ rawSms, senderHeader }),
    }),
  getSmsEvidence: (businessId: string) =>
    apiFetch<{ evidence: any[] }>(`/business/${businessId}/sms/evidence`),

  // Real Email Delivery
  testEmailSmtp: (data: any) =>
    apiFetch<{ success: boolean; message: string }>('/integrations/email/test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendLiveEmail: (data: any) =>
    apiFetch<{ success: boolean; messageId?: string; error?: string }>('/integrations/email/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getEmailQueue: (businessId: string) =>
    apiFetch<{ queue: any[] }>(`/business/${businessId}/email/queue`),

  // Real WhatsApp Dual Mode
  sendLiveWhatsApp: (data: any) =>
    apiFetch<{ mode: 'WEB_HAIL' | 'META_CLOUD_API'; success: boolean; handoffUrl?: string; externalMessageId?: string; error?: string }>('/integrations/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

