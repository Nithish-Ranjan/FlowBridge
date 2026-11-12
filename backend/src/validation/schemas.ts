import { z } from 'zod';
import { parseIsoDate, parsePaise } from '@flowbridge/shared';

export const UuidSchema = z.string().uuid('Must be a valid UUID');

export const PaiseStringSchema = z
  .string()
  .regex(/^-?\d+$/, 'Must be a decimal integer paise string (no floats)');

export const PositivePaiseStringSchema = PaiseStringSchema.refine(
  (v) => /^-?\d+$/.test(v) && parsePaise(v) > 0n,
  { message: 'Monetary amountPaise must be a strictly positive integer paise string' },
);

export const IsoDateSchema = z.string().refine(
  (v) => {
    try {
      parseIsoDate(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid ISO calendar date (YYYY-MM-DD)' },
);

export const BusinessCreateSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(160),
  openingCashPaise: PaiseStringSchema,
  openingCashDate: IsoDateSchema,
  minimumCashPaise: PaiseStringSchema.default('0'),
  allocationPolicy: z
    .enum(['OLDEST_DUE_FIRST', 'EXPLICIT_THEN_OLDEST_DUE_FIRST'])
    .default('OLDEST_DUE_FIRST'),
});

export const ApprovalLimitsSchema = z.object({
  maxEarlyRequestPct: z.number().int().min(0).max(100),
  maxEarlyDays: z.number().int().min(0).max(90),
  defaultMaxSupplierDeferralPct: z.number().int().min(0).max(100),
  defaultMaxSupplierDeferralDays: z.number().int().min(0).max(90),
  protectEssentialExpenses: z.boolean(),
  maxActionsPerPlan: z.number().int().min(1).max(3),
});

export const BusinessSettingsSchema = z.object({
  openingCashPaise: PaiseStringSchema.optional(),
  openingCashDate: IsoDateSchema.optional(),
  minimumCashPaise: PaiseStringSchema.optional(),
  allocationPolicy: z.enum(['OLDEST_DUE_FIRST', 'EXPLICIT_THEN_OLDEST_DUE_FIRST']).optional(),
  approvalLimits: ApprovalLimitsSchema.optional(),
});

export const RetailerCreateSchema = z.object({
  retailerCode: z.string().min(2).max(40),
  name: z.string().min(2).max(160),
  contactName: z.string().max(120).optional().nullable(),
  phoneMasked: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  creditTermsDays: z.number().int().min(0).max(365).optional(),
  reliabilityScore: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const RetailerUpdateSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  contactName: z.string().max(120).optional().nullable(),
  phoneMasked: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  creditTermsDays: z.number().int().min(0).max(365).optional(),
  reliabilityScore: z.number().int().min(0).max(100).optional(),
  status: z.enum(['ACTIVE', 'HOLD', 'INACTIVE']).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const IdentifierCreateSchema = z.object({
  identifierType: z.enum(['UPI_ID', 'BANK_ACCOUNT']),
  rawValue: z.string().min(4).max(160),
  displayLabel: z.string().min(2).max(120),
  verified: z.boolean().default(true),
});

export const IdentifierUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  verified: z.boolean().optional(),
  displayLabel: z.string().min(2).max(120).optional(),
});

export const SupplierCreateSchema = z.object({
  supplierCode: z.string().min(2).max(40),
  name: z.string().min(2).max(160),
  contactName: z.string().max(120).optional().nullable(),
  phoneMasked: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  maxDeferralDays: z.number().int().min(0).max(90).default(7),
  maxDeferralPct: z.number().int().min(0).max(100).default(30),
  isCritical: z.boolean().default(false),
});

export const InvoiceCreateSchema = z.object({
  retailerId: UuidSchema,
  invoiceNumber: z.string().min(2).max(60),
  invoiceDate: IsoDateSchema,
  dueDate: IsoDateSchema,
  totalAmountPaise: PositivePaiseStringSchema,
  evidenceStatus: z.enum(['UNCONFIRMED', 'CONFIRMED_PROMISE', 'DISPUTED']).optional(),
  externalReference: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const InvoiceUpdateSchema = z.object({
  dueDate: IsoDateSchema.optional(),
  evidenceStatus: z.enum(['UNCONFIRMED', 'CONFIRMED_PROMISE', 'DISPUTED']).optional(),
  status: z.enum(['CANCELLED', 'WRITTEN_OFF']).optional(),
  externalReference: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const BillCreateSchema = z.object({
  supplierId: UuidSchema,
  billNumber: z.string().min(2).max(60),
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema,
  totalAmountPaise: PositivePaiseStringSchema,
  priorityTier: z.enum(['ESSENTIAL', 'NORMAL', 'FLEXIBLE']).default('NORMAL'),
  notes: z.string().max(500).optional().nullable(),
});

export const ExpenseCreateSchema = z.object({
  expenseCode: z.string().min(2).max(60),
  category: z.string().min(2).max(80),
  description: z.string().min(2).max(200),
  dueDate: IsoDateSchema,
  amountPaise: PositivePaiseStringSchema,
  priorityTier: z.enum(['ESSENTIAL', 'NORMAL', 'DEFERRABLE']).default('ESSENTIAL'),
  isProtected: z.boolean().default(true),
});

export const ParsedBankRowSchema = z.object({
  direction: z.enum(['INFLOW', 'OUTFLOW']).default('INFLOW'),
  paymentMethod: z.enum(['UPI', 'BANK_TRANSFER', 'OTHER']).default('UPI'),
  externalTransactionReference: z.string().max(120).optional().nullable(),
  explicitInvoiceReference: z.string().max(120).optional().nullable(),
  payerIdentifierType: z.enum(['UPI_ID', 'BANK_ACCOUNT']).optional().nullable(),
  payerIdentifierRaw: z.string().max(160).optional().nullable(),
  payerDisplayName: z.string().max(160).optional().nullable(),
  narration: z.string().max(400).default(''),
  amountPaise: PositivePaiseStringSchema,
  transactionTimestamp: z.string().datetime({ offset: true }),
  valueDate: IsoDateSchema,
});

export const ImportBankTransactionsSchema = z
  .object({
    filename: z.string().max(160).optional().nullable(),
    csvText: z.string().max(1_500_000, 'CSV exceeds 1.5 MB upload limit').optional(),
    rows: z.array(ParsedBankRowSchema).max(2000).optional(),
    sourceType: z.enum(['CSV_IMPORT', 'MANUAL_ENTRY']).optional(),
  })
  .refine((v) => Boolean(v.csvText?.trim()) || Boolean(v.rows && v.rows.length > 0), {
    message: 'Provide either non-empty csvText or a non-empty rows array',
  });

export const AllocationItemSchema = z.object({
  invoiceId: UuidSchema,
  amountPaise: PositivePaiseStringSchema,
  allocationMethod: z
    .enum(['EXPLICIT_INVOICE', 'OLDEST_DUE_FIRST', 'MANUAL_OVERRIDE'])
    .optional(),
});

export const ResolveMatchSchema = z.object({
  retailerId: UuidSchema,
  note: z.string().min(2).max(300).default('Distributor confirmed retailer match'),
  allocations: z.array(AllocationItemSchema).optional(),
  creditRemainderAsOverpayment: z.boolean().default(true),
});

export const AllocatePaymentSchema = z.object({
  allocations: z.array(AllocationItemSchema),
  creditRemainderAsOverpayment: z.boolean().default(true),
  notes: z.string().max(300).optional(),
});

export const ScenarioActionSchema = z.object({
  targetType: z.enum(['CUSTOMER_INVOICE', 'SUPPLIER_BILL', 'OPERATING_EXPENSE', 'SYNTHETIC_ADJUSTMENT']),
  targetId: UuidSchema.nullable(),
  targetLabel: z.string().min(1).max(160),
  actionType: z.enum([
    'ACCELERATE_INFLOW',
    'DELAY_INFLOW',
    'DROP_INFLOW_PCT',
    'DEFER_OUTFLOW',
    'SPLIT_OUTFLOW',
  ]),
  amountPaise: PaiseStringSchema,
  originalDate: IsoDateSchema.nullable(),
  simulatedDate: IsoDateSchema,
});

export const ScenarioCreateSchema = z.object({
  name: z.string().min(2).max(140),
  description: z.string().max(400).optional().nullable(),
  scenarioKind: z.enum(['BASELINE', 'RESOLUTION_PLAN', 'SHOCKWAVE_WHAT_IF', 'EMERGENCY_FALLBACK']).default('SHOCKWAVE_WHAT_IF'),
  asOfDate: IsoDateSchema.optional(),
  horizonDays: z.number().int().min(1).max(180).default(15),
  actions: z.array(ScenarioActionSchema).min(1),
});

export const CommitmentCreateSchema = z.object({
  counterpartyType: z.enum(['RETAILER', 'SUPPLIER', 'EXPENSE']),
  retailerId: UuidSchema.optional().nullable(),
  customerInvoiceId: UuidSchema.optional().nullable(),
  supplierId: UuidSchema.optional().nullable(),
  supplierBillId: UuidSchema.optional().nullable(),
  operatingExpenseId: UuidSchema.optional().nullable(),
  scenarioId: UuidSchema.optional().nullable(),
  actionType: z.enum([
    'EARLY_RECEIPT',
    'PARTIAL_COLLECTION',
    'SUPPLIER_DEFERRAL',
    'EXPENSE_DEFERRAL',
    'PAYMENT_PLAN',
  ]),
  proposedAmountPaise: PositivePaiseStringSchema,
  proposedDate: IsoDateSchema,
});

export const CommitmentStatusUpdateSchema = z.object({
  status: z.enum(['AGREED', 'CANCELLED', 'FAILED', 'COMPLETED', 'AT_RISK']),
  humanReplyBy: z.string().min(2).max(120),
  humanReplyChannel: z.string().min(2).max(60),
  humanReplyNotes: z.string().max(400).optional().nullable(),
  agreedAmountPaise: PositivePaiseStringSchema.optional().nullable(),
  agreedDate: IsoDateSchema.optional().nullable(),
  fulfilledAmountPaise: PaiseStringSchema.optional().nullable(),
});
