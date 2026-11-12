import {
  findForbiddenCredentialKey,
  maskPaymentIdentifier,
  parseIsoDate,
  parsePaise,
  paiseToString,
  type AllocationMethod,
  type IdentifierType,
  type MatchEvidence,
  type MatchEvidenceCandidate,
  type MatchStatus,
  type PaymentAllocationDTO,
  type PaymentDirection,
  type PaymentMethod,
  type PaymentTransactionDTO,
  type RecordOrigin,
} from '@flowbridge/shared';
import type { PoolClient } from 'pg';
import { getEnv } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { getBusinessById } from '../db/repositories/businessRepo.js';
import {
  findInvoicesByExplicitReference,
  listOpenInvoicesForRetailer,
} from '../db/repositories/ledgerRepo.js';
import {
  assignManualRetailerMatch,
  getPaymentTransactionById,
  insertPaymentAllocation,
  insertPaymentTransactionIfUnique,
  insertRetailerCreditEvent,
  listPaymentAllocations,
  recordAuditEvent,
} from '../db/repositories/paymentRepo.js';
import {
  findVerifiedRetailersByFingerprint,
  getRetailerById,
} from '../db/repositories/retailerRepo.js';
import { computeIdentifierHmac, computeTransactionFingerprint } from '../utils/crypto.js';
import {
  computeAllocationPreviewLines,
  decideRetailerMatch,
  extractExplicitInvoiceCandidates,
} from './paymentMatchingLogic.js';

export interface IncomingPaymentInput {
  direction: PaymentDirection;
  paymentMethod: PaymentMethod;
  externalTransactionReference?: string | null;
  explicitInvoiceReference?: string | null;
  payerIdentifierType?: IdentifierType | null;
  payerIdentifierRaw?: string | null;
  payerDisplayName?: string | null;
  narration?: string;
  amountPaise: string;
  transactionTimestamp: string;
  valueDate: string;
  sourceType: RecordOrigin;
}

export interface AllocationPreviewLine {
  invoiceId: string;
  invoiceNumber: string;
  dueDate: string;
  currentOutstandingPaise: string;
  proposedAllocatePaise: string;
  postAllocationOutstandingPaise: string;
  allocationMethod: AllocationMethod;
}

export interface AllocationPreviewResult {
  paymentId: string;
  retailerId: string;
  retailerCode: string;
  retailerName: string;
  remainingPaymentPaise: string;
  allocationPolicy: string;
  lines: AllocationPreviewLine[];
  totalProposedAllocatePaise: string;
  unappliedOverpaymentPaise: string;
  requiresConfirmation: true;
}

export async function evaluateRetailerMatch(
  businessId: string,
  input: {
    direction: PaymentDirection;
    explicitInvoiceReference?: string | null;
    narration: string;
    payerIdentifierType?: IdentifierType | null;
    payerIdentifierFingerprint?: string | null;
    payerIdentifierMasked?: string | null;
  },
  client?: PoolClient,
): Promise<{
  matchStatus: MatchStatus;
  matchedRetailerId: string | null;
  matchEvidence: MatchEvidence;
}> {
  if (input.direction !== 'INFLOW') {
    return decideRetailerMatch(input.direction, []);
  }

  const candidates: MatchEvidenceCandidate[] = [];

  // 1. Check explicit invoice/payment reference
  const refTokens = extractExplicitInvoiceCandidates(input.explicitInvoiceReference, input.narration);
  for (const token of refTokens) {
    const matchedInvs = await findInvoicesByExplicitReference(businessId, token, client);
    for (const inv of matchedInvs) {
      candidates.push({
        retailerId: inv.retailerId,
        retailerCode: inv.retailerCode ?? '',
        retailerName: inv.retailerName ?? 'Retailer',
        reason: 'EXPLICIT_INVOICE_REF',
        matchedTokenMasked: token,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
      });
    }
  }

  // 2. Check exact match against verified payer identifier HMAC
  if (input.payerIdentifierFingerprint) {
    const idHits = await findVerifiedRetailersByFingerprint(
      businessId,
      input.payerIdentifierFingerprint,
      client,
    );
    for (const hit of idHits) {
      candidates.push({
        retailerId: hit.retailerId,
        retailerCode: hit.retailerCode,
        retailerName: hit.retailerName,
        reason:
          hit.identifierType === 'UPI_ID'
            ? 'EXACT_VERIFIED_UPI_HMAC'
            : 'EXACT_VERIFIED_BANK_REF_HMAC',
        matchedTokenMasked: hit.maskedValue,
      });
    }
  }

  return decideRetailerMatch(input.direction, candidates);
}

export async function recordSinglePaymentTransaction(
  businessId: string,
  input: IncomingPaymentInput,
  importBatchId: string | null = null,
  client?: PoolClient,
): Promise<{ inserted: boolean; duplicate: boolean; transaction: PaymentTransactionDTO | null }> {
  const forbidden = findForbiddenCredentialKey(input);
  if (forbidden) {
    throw new Error(`Forbidden credential field "${forbidden}" cannot be accepted or stored.`);
  }

  const env = getEnv();
  const amount = parsePaise(input.amountPaise);
  if (amount <= 0n) {
    throw new Error('Payment amountPaise must be strictly positive.');
  }
  const valueDate = parseIsoDate(input.valueDate);
  const tsIso = new Date(input.transactionTimestamp).toISOString();

  let payerFp: string | null = null;
  let payerMasked: string | null = null;
  if (input.payerIdentifierRaw && input.payerIdentifierRaw.trim()) {
    const inferredType: IdentifierType =
      input.payerIdentifierType ??
      (input.payerIdentifierRaw.includes('@') ? 'UPI_ID' : 'BANK_ACCOUNT');
    payerFp = computeIdentifierHmac(inferredType, input.payerIdentifierRaw, env.IDENTIFIER_HMAC_SECRET);
    payerMasked = maskPaymentIdentifier(inferredType, input.payerIdentifierRaw);
  }

  const txFp = computeTransactionFingerprint(
    {
      direction: input.direction,
      paymentMethod: input.paymentMethod,
      externalTransactionReference: input.externalTransactionReference,
      amountPaise: paiseToString(amount),
      valueDate,
      transactionTimestamp: tsIso,
      payerIdentifierFingerprint: payerFp,
      narration: input.narration ?? '',
    },
    env.TX_FINGERPRINT_SECRET,
  );

  const match = await evaluateRetailerMatch(
    businessId,
    {
      direction: input.direction,
      explicitInvoiceReference: input.explicitInvoiceReference,
      narration: input.narration ?? '',
      payerIdentifierType: input.payerIdentifierType,
      payerIdentifierFingerprint: payerFp,
      payerIdentifierMasked: payerMasked,
    },
    client,
  );

  const res = await insertPaymentTransactionIfUnique(
    {
      businessId,
      importBatchId,
      direction: input.direction,
      paymentMethod: input.paymentMethod,
      externalTransactionReference: input.externalTransactionReference?.trim() || null,
      explicitInvoiceReference: input.explicitInvoiceReference?.trim() || null,
      payerIdentifierFingerprint: payerFp,
      payerIdentifierMasked: payerMasked,
      payerDisplayName: input.payerDisplayName?.trim() || null,
      narration: (input.narration ?? '').trim(),
      amountPaise: paiseToString(amount),
      transactionTimestamp: tsIso,
      valueDate,
      transactionFingerprint: txFp,
      matchStatus: match.matchStatus,
      matchedRetailerId: match.matchedRetailerId,
      matchEvidence: match.matchEvidence,
      sourceType: input.sourceType,
    },
    client,
  );

  if (!res.inserted) {
    return { inserted: false, duplicate: true, transaction: null };
  }

  await recordAuditEvent(
    {
      businessId,
      eventType: 'PAYMENT_RECORDED',
      entityType: 'payment_transactions',
      entityId: res.transaction!.id,
      actor: input.sourceType,
      payload: {
        amountPaise: res.transaction!.amountPaise,
        matchStatus: res.transaction!.matchStatus,
        matchedRetailerId: res.transaction!.matchedRetailerId,
        rule: match.matchEvidence.rule,
      },
    },
    client,
  );

  return { inserted: true, duplicate: false, transaction: res.transaction };
}

export async function resolveManualMatch(
  businessId: string,
  paymentId: string,
  retailerId: string,
  actorNote: string,
  optionalAllocations?: Array<{
    invoiceId: string;
    amountPaise: string;
    allocationMethod?: AllocationMethod;
  }>,
  creditRemainderAsOverpayment = true,
): Promise<{
  transaction: PaymentTransactionDTO;
  allocationResult?: {
    createdAllocations: PaymentAllocationDTO[];
    overpaymentCreditedPaise: string;
  };
}> {
  const matched = await withTransaction(async (client) => {
    const payment = await getPaymentTransactionById(businessId, paymentId, true, client);
    if (!payment) throw new Error('Payment transaction not found.');
    if (payment.direction !== 'INFLOW') {
      throw new Error('Only INFLOW transactions can be matched to a retailer.');
    }
    if (payment.isReversed) {
      throw new Error('Cannot match a reversed transaction.');
    }
    const retailer = await getRetailerById(businessId, retailerId, client);
    if (!retailer) throw new Error('Retailer not found in this business.');

    const evidence: MatchEvidence = {
      decision: 'MATCHED',
      rule: 'DISTRIBUTOR_MANUAL_REVIEW',
      explanation: `Manually confirmed by distributor for ${retailer.retailerCode} (${retailer.name}). Note: ${actorNote}`,
      candidates: payment.matchEvidence.candidates,
    };

    const updated = await assignManualRetailerMatch(businessId, paymentId, retailerId, evidence, client);
    await recordAuditEvent(
      {
        businessId,
        eventType: 'PAYMENT_MANUALLY_MATCHED',
        entityType: 'payment_transactions',
        entityId: paymentId,
        actor: 'DISTRIBUTOR',
        payload: { retailerId, retailerCode: retailer.retailerCode, note: actorNote },
      },
      client,
    );
    return updated!;
  });

  if (optionalAllocations && optionalAllocations.length > 0) {
    const allocRes = await confirmPaymentAllocation(
      businessId,
      paymentId,
      optionalAllocations,
      creditRemainderAsOverpayment,
      `Allocated during resolve-match: ${actorNote}`,
    );
    return {
      transaction: allocRes.payment,
      allocationResult: {
        createdAllocations: allocRes.createdAllocations,
        overpaymentCreditedPaise: allocRes.overpaymentCreditedPaise,
      },
    };
  }

  return { transaction: matched };
}

export async function previewPaymentAllocation(
  businessId: string,
  paymentId: string,
): Promise<AllocationPreviewResult> {
  const business = await getBusinessById(businessId);
  if (!business) throw new Error('Business not found.');
  const payment = await getPaymentTransactionById(businessId, paymentId);
  if (!payment) throw new Error('Payment transaction not found.');
  if (payment.matchStatus !== 'MATCHED' || !payment.matchedRetailerId) {
    throw new Error('Payment must be matched to a verified retailer before previewing allocation.');
  }
  if (payment.isReversed) {
    throw new Error('Cannot allocate a reversed payment.');
  }

  const retailer = await getRetailerById(businessId, payment.matchedRetailerId);
  if (!retailer) throw new Error('Matched retailer not found.');

  const openInvoices = await listOpenInvoicesForRetailer(businessId, retailer.id);
  const preview = computeAllocationPreviewLines(
    payment.remainingToAllocatePaise,
    openInvoices,
    payment.explicitInvoiceReference,
    payment.narration,
  );

  return {
    paymentId: payment.id,
    retailerId: retailer.id,
    retailerCode: retailer.retailerCode,
    retailerName: retailer.name,
    remainingPaymentPaise: payment.remainingToAllocatePaise,
    allocationPolicy: business.allocationPolicy,
    lines: preview.lines,
    totalProposedAllocatePaise: preview.totalProposedAllocatePaise,
    unappliedOverpaymentPaise: preview.unappliedOverpaymentPaise,
    requiresConfirmation: true,
  };
}

export async function confirmPaymentAllocation(
  businessId: string,
  paymentId: string,
  allocations: Array<{
    invoiceId: string;
    amountPaise: string;
    allocationMethod?: AllocationMethod;
  }>,
  creditRemainderAsOverpayment = true,
  notes?: string,
): Promise<{
  payment: PaymentTransactionDTO;
  createdAllocations: PaymentAllocationDTO[];
  overpaymentCreditedPaise: string;
}> {
  return withTransaction(async (client) => {
    const payment = await getPaymentTransactionById(businessId, paymentId, true, client);
    if (!payment) throw new Error('Payment transaction not found.');
    if (payment.matchStatus !== 'MATCHED' || !payment.matchedRetailerId) {
      throw new Error('Payment must be MATCHED to a retailer before confirming allocation.');
    }
    if (payment.isReversed) {
      throw new Error('Cannot allocate a reversed payment.');
    }

    const available = parsePaise(payment.remainingToAllocatePaise);
    let requestedSum = 0n;
    for (const item of allocations) {
      const amt = parsePaise(item.amountPaise);
      if (amt <= 0n) {
        throw new Error('Each allocation amountPaise must be > 0.');
      }
      requestedSum += amt;
    }

    if (requestedSum > available) {
      throw new Error(
        `Requested allocation total (${requestedSum}) exceeds remaining unallocated payment (${available}).`,
      );
    }

    // Lock open invoices of the retailer before inserting allocations
    const openInvoices = await listOpenInvoicesForRetailer(
      businessId,
      payment.matchedRetailerId,
      true,
      client,
    );
    const invoiceMap = new Map(openInvoices.map((inv) => [inv.id, inv]));

    const createdAllocations: PaymentAllocationDTO[] = [];
    for (const item of allocations) {
      const inv = invoiceMap.get(item.invoiceId);
      if (!inv) {
        throw new Error(`Invoice ${item.invoiceId} is not open for this retailer.`);
      }
      const amt = parsePaise(item.amountPaise);
      const out = parsePaise(inv.outstandingPaise);
      if (amt > out) {
        throw new Error(
          `Allocation (${amt}) exceeds outstanding balance (${out}) on invoice ${inv.invoiceNumber}.`,
        );
      }

      const row = await insertPaymentAllocation(
        {
          businessId,
          paymentTransactionId: payment.id,
          invoiceId: inv.id,
          entryType: 'ALLOCATION',
          allocatedAmountPaise: paiseToString(amt),
          allocationMethod: item.allocationMethod ?? 'OLDEST_DUE_FIRST',
          notes: notes ?? 'Distributor confirmed allocation',
        },
        client,
      );
      createdAllocations.push(row);

      // Update fulfilled commitments linked to this invoice if any
      await client.query(
        `UPDATE commitments
            SET fulfilled_amount_paise = LEAST(
                  COALESCE(agreed_amount_paise, proposed_amount_paise),
                  fulfilled_amount_paise + $3
                ),
                status = CASE
                  WHEN fulfilled_amount_paise + $3 >= COALESCE(agreed_amount_paise, proposed_amount_paise)
                  THEN 'COMPLETED'
                  ELSE status
                END
          WHERE business_id = $1
            AND customer_invoice_id = $2
            AND status IN ('AGREED', 'AT_RISK')`,
        [businessId, inv.id, paiseToString(amt)],
      );
    }

    const remainder = available - requestedSum;
    let overpaymentCredited = 0n;

    if (creditRemainderAsOverpayment && remainder > 0n) {
      overpaymentCredited = remainder;
      await insertRetailerCreditEvent(
        {
          businessId,
          retailerId: payment.matchedRetailerId,
          paymentTransactionId: payment.id,
          entryType: 'OVERPAYMENT_CREDIT',
          amountPaise: paiseToString(remainder),
          notes: `Unapplied overpayment from payment ${payment.externalTransactionReference ?? payment.id}`,
        },
        client,
      );

      await client.query(
        `UPDATE payment_transactions
            SET unapplied_credit_paise = unapplied_credit_paise + $2,
                allocation_status = 'OVERPAYMENT_CREDITED'
          WHERE id = $1`,
        [payment.id, paiseToString(remainder)],
      );
    }

    await client.query(
      `UPDATE payment_transactions
          SET verification_status = 'VERIFIED'
        WHERE id = $1`,
      [payment.id],
    );

    await recordAuditEvent(
      {
        businessId,
        eventType: 'PAYMENT_ALLOCATED',
        entityType: 'payment_transactions',
        entityId: payment.id,
        actor: 'DISTRIBUTOR',
        payload: {
          allocatedCount: createdAllocations.length,
          totalAllocatedPaise: paiseToString(requestedSum),
          overpaymentCreditedPaise: paiseToString(overpaymentCredited),
        },
      },
      client,
    );

    const updatedPayment = await getPaymentTransactionById(businessId, payment.id, false, client);
    return {
      payment: updatedPayment!,
      createdAllocations,
      overpaymentCreditedPaise: paiseToString(overpaymentCredited),
    };
  });
}

export async function reversePaymentTransaction(
  businessId: string,
  paymentId: string,
  reason: string,
): Promise<{
  payment: PaymentTransactionDTO;
  reversalAllocations: PaymentAllocationDTO[];
}> {
  return withTransaction(async (client) => {
    const payment = await getPaymentTransactionById(businessId, paymentId, true, client);
    if (!payment) throw new Error('Payment transaction not found.');
    if (payment.isReversed) {
      throw new Error('Payment transaction is already reversed.');
    }

    const existingAllocs = await listPaymentAllocations(businessId, payment.id, client);
    const alreadyReversedIds = new Set(
      existingAllocs
        .filter((a) => a.entryType === 'REVERSAL' && a.reversedAllocationId)
        .map((a) => a.reversedAllocationId!),
    );

    const activeAllocs = existingAllocs.filter(
      (a) => a.entryType === 'ALLOCATION' && !alreadyReversedIds.has(a.id),
    );

    // Mark payment reversed first? Wait: trigger checks v_payment.is_reversed only on ALLOCATION,
    // so inserting REVERSAL entries works cleanly either way. Mark payment reversed at end.
    const reversalAllocations: PaymentAllocationDTO[] = [];
    for (const orig of activeAllocs) {
      const negAmt = -parsePaise(orig.allocatedAmountPaise);
      const rev = await insertPaymentAllocation(
        {
          businessId,
          paymentTransactionId: payment.id,
          invoiceId: orig.invoiceId,
          entryType: 'REVERSAL',
          allocatedAmountPaise: paiseToString(negAmt),
          allocationMethod: orig.allocationMethod,
          reversedAllocationId: orig.id,
          notes: `Reversal: ${reason}`,
        },
        client,
      );
      reversalAllocations.push(rev);

      await client.query(
        `UPDATE commitments
            SET fulfilled_amount_paise = GREATEST(0, fulfilled_amount_paise - $3),
                status = CASE
                  WHEN status = 'COMPLETED'
                   AND GREATEST(0, fulfilled_amount_paise - $3) < COALESCE(agreed_amount_paise, proposed_amount_paise)
                  THEN 'AGREED'
                  ELSE status
                END
          WHERE business_id = $1
            AND customer_invoice_id = $2
            AND status IN ('AGREED', 'AT_RISK', 'COMPLETED')`,
        [businessId, orig.invoiceId, paiseToString(parsePaise(orig.allocatedAmountPaise))],
      );
    }

    const unapplied = parsePaise(payment.unappliedCreditPaise);
    if (unapplied > 0n && payment.matchedRetailerId) {
      await insertRetailerCreditEvent(
        {
          businessId,
          retailerId: payment.matchedRetailerId,
          paymentTransactionId: payment.id,
          entryType: 'CREDIT_REVERSAL',
          amountPaise: paiseToString(-unapplied),
          notes: `Credit reversal: ${reason}`,
        },
        client,
      );
    }

    await client.query(
      `UPDATE payment_transactions
          SET is_reversed = true,
              unapplied_credit_paise = 0,
              allocation_status = 'REVERSED',
              verification_status = 'REVERSED'
        WHERE id = $1`,
      [payment.id],
    );

    await recordAuditEvent(
      {
        businessId,
        eventType: 'PAYMENT_REVERSED',
        entityType: 'payment_transactions',
        entityId: payment.id,
        actor: 'DISTRIBUTOR',
        payload: {
          reason,
          reversedAllocationsCount: reversalAllocations.length,
          reversedUnappliedCreditPaise: paiseToString(unapplied),
        },
      },
      client,
    );

    const updated = await getPaymentTransactionById(businessId, payment.id, false, client);
    return { payment: updated!, reversalAllocations };
  });
}
