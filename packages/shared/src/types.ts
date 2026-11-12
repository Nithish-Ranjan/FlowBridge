import type { IsoDate } from './dates.js';
import type { PaiseString } from './money.js';

export type DataClassification = 'ACTUAL' | 'EXPECTED' | 'SCENARIO';
export type RecordOrigin = 'SEEDED_DEMO' | 'MANUAL_ENTRY' | 'CSV_IMPORT';
export type AllocationPolicy = 'OLDEST_DUE_FIRST' | 'EXPLICIT_THEN_OLDEST_DUE_FIRST';

export type IdentifierType = 'UPI_ID' | 'BANK_ACCOUNT';
export type PaymentDirection = 'INFLOW' | 'OUTFLOW';
export type PaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'OTHER';
export type MatchStatus = 'UNMATCHED' | 'AMBIGUOUS' | 'MATCHED';
export type AllocationStatus =
  | 'UNAPPLIED'
  | 'PARTIALLY_ALLOCATED'
  | 'ALLOCATED'
  | 'OVERPAYMENT_CREDITED'
  | 'REVERSED';
export type VerificationStatus = 'PENDING_REVIEW' | 'VERIFIED' | 'REVERSED';
export type AllocationMethod = 'EXPLICIT_INVOICE' | 'OLDEST_DUE_FIRST' | 'MANUAL_OVERRIDE';

export type InvoiceStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'WRITTEN_OFF';
export type InvoiceEvidenceStatus = 'UNCONFIRMED' | 'CONFIRMED_PROMISE' | 'DISPUTED' | 'VERIFIED_PAID';
export type BillStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'DEFERRED' | 'CANCELLED';
export type ExpenseStatus = 'SCHEDULED' | 'PAID' | 'DEFERRED' | 'CANCELLED';

export type CommitmentStatus = 'PROPOSED' | 'AGREED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'AT_RISK';
export type CommitmentActionType =
  | 'EARLY_RECEIPT'
  | 'PARTIAL_COLLECTION'
  | 'SUPPLIER_DEFERRAL'
  | 'EXPENSE_DEFERRAL'
  | 'PAYMENT_PLAN';

export interface ApprovalLimits {
  /** Maximum percentage of an invoice requested early without penalty */
  maxEarlyRequestPct: number;
  /** Maximum number of days earlier a customer receipt may be requested */
  maxEarlyDays: number;
  /** Default maximum percentage of a supplier bill allowed to request deferral on */
  defaultMaxSupplierDeferralPct: number;
  /** Default maximum deferral days for flexible supplier bills */
  defaultMaxSupplierDeferralDays: number;
  /** Whether essential operating expenses are protected by the Liquidity Firewall */
  protectEssentialExpenses: boolean;
  /** Maximum number of actions permitted in a single resolution plan */
  maxActionsPerPlan: number;
}

export interface BusinessDTO {
  id: string;
  code: string;
  name: string;
  currency: 'INR';
  timezone: string;
  openingCashPaise: PaiseString;
  openingCashDate: IsoDate;
  minimumCashPaise: PaiseString;
  allocationPolicy: AllocationPolicy;
  approvalLimits: ApprovalLimits;
  createdAt: string;
  updatedAt: string;
}

export interface RetailerDTO {
  id: string;
  businessId: string;
  retailerCode: string;
  name: string;
  contactName: string | null;
  phoneMasked: string | null;
  email: string | null;
  creditTermsDays: number;
  reliabilityScore: number;
  unappliedCreditPaise: PaiseString;
  status: 'ACTIVE' | 'HOLD' | 'INACTIVE';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetailerPaymentIdentifierDTO {
  id: string;
  businessId: string;
  retailerId: string;
  identifierType: IdentifierType;
  maskedValue: string;
  displayLabel: string;
  verifiedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDTO {
  id: string;
  businessId: string;
  supplierCode: string;
  name: string;
  contactName: string | null;
  phoneMasked: string | null;
  email: string | null;
  maxDeferralDays: number;
  maxDeferralPct: number;
  isCritical: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInvoiceDTO {
  id: string;
  businessId: string;
  retailerId: string;
  retailerCode?: string;
  retailerName?: string;
  invoiceNumber: string;
  invoiceDate: IsoDate;
  dueDate: IsoDate;
  totalAmountPaise: PaiseString;
  paidAmountPaise: PaiseString;
  outstandingPaise: PaiseString;
  status: InvoiceStatus;
  evidenceStatus: InvoiceEvidenceStatus;
  externalReference: string | null;
  recordOrigin: RecordOrigin;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierBillDTO {
  id: string;
  businessId: string;
  supplierId: string;
  supplierCode?: string;
  supplierName?: string;
  billNumber: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  totalAmountPaise: PaiseString;
  paidAmountPaise: PaiseString;
  outstandingPaise: PaiseString;
  status: BillStatus;
  evidenceStatus: 'CONFIRMED' | 'DISPUTED' | 'VERIFIED_PAID';
  priorityTier: 'ESSENTIAL' | 'NORMAL' | 'FLEXIBLE';
  recordOrigin: RecordOrigin;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperatingExpenseDTO {
  id: string;
  businessId: string;
  expenseCode: string;
  category: string;
  description: string;
  dueDate: IsoDate;
  amountPaise: PaiseString;
  paidAmountPaise: PaiseString;
  outstandingPaise: PaiseString;
  status: ExpenseStatus;
  priorityTier: 'ESSENTIAL' | 'NORMAL' | 'DEFERRABLE';
  isProtected: boolean;
  recordOrigin: RecordOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface MatchEvidenceCandidate {
  retailerId: string;
  retailerCode: string;
  retailerName: string;
  reason: 'EXPLICIT_INVOICE_REF' | 'EXACT_VERIFIED_UPI_HMAC' | 'EXACT_VERIFIED_BANK_REF_HMAC';
  matchedTokenMasked: string;
  invoiceId?: string;
  invoiceNumber?: string;
}

export interface MatchEvidence {
  decision: MatchStatus;
  rule: string;
  explanation: string;
  candidates: MatchEvidenceCandidate[];
}

export interface PaymentTransactionDTO {
  id: string;
  businessId: string;
  importBatchId: string | null;
  direction: PaymentDirection;
  paymentMethod: PaymentMethod;
  externalTransactionReference: string | null;
  explicitInvoiceReference: string | null;
  payerIdentifierMasked: string | null;
  payerDisplayName: string | null;
  narration: string;
  amountPaise: PaiseString;
  allocatedAmountPaise: PaiseString;
  unappliedCreditPaise: PaiseString;
  remainingToAllocatePaise: PaiseString;
  transactionTimestamp: string;
  valueDate: IsoDate;
  matchStatus: MatchStatus;
  matchedRetailerId: string | null;
  matchedRetailerCode?: string | null;
  matchedRetailerName?: string | null;
  matchEvidence: MatchEvidence;
  allocationStatus: AllocationStatus;
  verificationStatus: VerificationStatus;
  sourceType: RecordOrigin;
  reversalOfTransactionId: string | null;
  isReversed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAllocationDTO {
  id: string;
  businessId: string;
  paymentTransactionId: string;
  invoiceId: string;
  invoiceNumber?: string;
  entryType: 'ALLOCATION' | 'REVERSAL';
  allocatedAmountPaise: PaiseString;
  allocationMethod: AllocationMethod;
  reversedAllocationId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CommitmentDTO {
  id: string;
  businessId: string;
  counterpartyType: 'RETAILER' | 'SUPPLIER' | 'EXPENSE';
  retailerId: string | null;
  customerInvoiceId: string | null;
  supplierId: string | null;
  supplierBillId: string | null;
  operatingExpenseId: string | null;
  scenarioId: string | null;
  actionType: CommitmentActionType;
  proposedAmountPaise: PaiseString;
  proposedDate: IsoDate;
  agreedAmountPaise: PaiseString | null;
  agreedDate: IsoDate | null;
  dueDate: IsoDate;
  status: CommitmentStatus;
  humanReplyRecorded: boolean;
  humanReplyBy: string | null;
  humanReplyChannel: string | null;
  humanReplyNotes: string | null;
  humanRepliedAt: string | null;
  fulfilledAmountPaise: PaiseString;
  createdAt: string;
  updatedAt: string;
}

export interface ForecastItemTrace {
  sourceType:
    | 'CUSTOMER_INVOICE'
    | 'SUPPLIER_BILL'
    | 'OPERATING_EXPENSE'
    | 'COMMITMENT'
    | 'SCENARIO_ACTION'
    | 'PAYMENT_TRANSACTION';
  sourceId: string;
  referenceCode: string;
  counterpartyName: string;
  direction: PaymentDirection;
  amountPaise: PaiseString;
  classification: DataClassification;
  evidenceStatus: string;
  dueDate: IsoDate;
  note?: string;
}

export interface ForecastDayEntry {
  date: IsoDate;
  dayIndex: number;
  openingBalancePaise: PaiseString;
  totalInflowsPaise: PaiseString;
  totalOutflowsPaise: PaiseString;
  closingBalancePaise: PaiseString;
  belowMinimum: boolean;
  deficitPaise: PaiseString;
  items: ForecastItemTrace[];
}

export interface BreachDiagnostic {
  firstBreachDate: IsoDate | null;
  firstBreachDayIndex: number | null;
  firstBreachClosingPaise: PaiseString | null;
  minimumCashPaise: PaiseString;
  shortfallPaise: PaiseString;
  lowestBalanceDate: IsoDate;
  lowestBalancePaise: PaiseString;
  recoveryDate: IsoDate | null;
  isTimingGapOnly: boolean;
  explanationSummary: string;
  outflowDrivers: ForecastItemTrace[];
  delayedOrUnconfirmedInflows: ForecastItemTrace[];
}

export interface ChasePriorityItem {
  invoiceId: string;
  invoiceNumber: string;
  retailerId: string;
  retailerCode: string;
  retailerName: string;
  dueDate: IsoDate;
  outstandingPaise: PaiseString;
  evidenceStatus: InvoiceEvidenceStatus;
  reliabilityScore: number;
  priorityScore: number;
  rationale: string;
}

export interface TrustScoreCounters {
  totalRecords: number;
  actualCount: number;
  confirmedCount: number;
  unconfirmedExpectedCount: number;
  unmatchedOrAmbiguousPayments: number;
  trustRatioPct: number;
}

export interface ForecastResult {
  businessId: string;
  asOfDate: IsoDate;
  horizonDays: number;
  classification: 'ACTUAL_PLUS_EXPECTED' | 'SCENARIO_WHAT_IF';
  openingCashPaise: PaiseString;
  minimumCashPaise: PaiseString;
  days: ForecastDayEntry[];
  breach: BreachDiagnostic;
  chasePriorities: ChasePriorityItem[];
  trustCounters: TrustScoreCounters;
}

