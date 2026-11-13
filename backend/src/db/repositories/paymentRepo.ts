import type { PoolClient } from 'pg';
import type {
  AllocationMethod,
  MatchEvidence,
  MatchStatus,
  PaymentAllocationDTO,
  PaymentDirection,
  PaymentMethod,
  PaymentTransactionDTO,
  RecordOrigin,
} from '@flowbridge/shared';
import { parsePaise, paiseToString } from '@flowbridge/shared';
import { isMemoryDbActive, query } from '../pool.js';

interface PaymentTransactionRow {
  id: string;
  business_id: string;
  import_batch_id: string | null;
  direction: PaymentDirection;
  payment_method: PaymentMethod;
  external_transaction_reference: string | null;
  explicit_invoice_reference: string | null;
  payer_identifier_fingerprint: string | null;
  payer_identifier_masked: string | null;
  payer_display_name: string | null;
  narration: string;
  amount_paise: string;
  allocated_amount_paise: string;
  unapplied_credit_paise: string;
  transaction_timestamp: Date;
  value_date: string;
  transaction_fingerprint: string;
  match_status: MatchStatus;
  matched_retailer_id: string | null;
  matched_retailer_code?: string | null;
  matched_retailer_name?: string | null;
  match_evidence_json: MatchEvidence;
  allocation_status: PaymentTransactionDTO['allocationStatus'];
  verification_status: PaymentTransactionDTO['verificationStatus'];
  source_type: RecordOrigin;
  reversal_of_transaction_id: string | null;
  is_reversed: boolean;
  created_at: Date;
  updated_at: Date;
}

interface PaymentAllocationRow {
  id: string;
  business_id: string;
  payment_transaction_id: string;
  invoice_id: string;
  invoice_number?: string;
  entry_type: 'ALLOCATION' | 'REVERSAL';
  allocated_amount_paise: string;
  allocation_method: AllocationMethod;
  reversed_allocation_id: string | null;
  notes: string | null;
  created_at: Date;
}

export interface ImportBatchDTO {
  id: string;
  businessId: string;
  sourceType: RecordOrigin;
  filename: string | null;
  importedAt: string;
  status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL_WITH_ERRORS' | 'FAILED';
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  errorRows: number;
  errorSummary: unknown[];
}

function mapPayment(row: PaymentTransactionRow): PaymentTransactionDTO {
  const remaining =
    parsePaise(row.amount_paise) -
    parsePaise(row.allocated_amount_paise) -
    parsePaise(row.unapplied_credit_paise);

  return {
    id: row.id,
    businessId: row.business_id,
    importBatchId: row.import_batch_id,
    direction: row.direction,
    paymentMethod: row.payment_method,
    externalTransactionReference: row.external_transaction_reference,
    explicitInvoiceReference: row.explicit_invoice_reference,
    payerIdentifierMasked: row.payer_identifier_masked,
    payerDisplayName: row.payer_display_name,
    narration: row.narration,
    amountPaise: String(row.amount_paise),
    allocatedAmountPaise: String(row.allocated_amount_paise),
    unappliedCreditPaise: String(row.unapplied_credit_paise),
    remainingToAllocatePaise: paiseToString(remaining > 0n ? remaining : 0n),
    transactionTimestamp: row.transaction_timestamp.toISOString(),
    valueDate: row.value_date,
    matchStatus: row.match_status,
    matchedRetailerId: row.matched_retailer_id,
    matchedRetailerCode: row.matched_retailer_code ?? null,
    matchedRetailerName: row.matched_retailer_name ?? null,
    matchEvidence: row.match_evidence_json,
    allocationStatus: row.allocation_status,
    verificationStatus: row.verification_status,
    sourceType: row.source_type,
    reversalOfTransactionId: row.reversal_of_transaction_id,
    isReversed: row.is_reversed,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapAllocation(row: PaymentAllocationRow): PaymentAllocationDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    paymentTransactionId: row.payment_transaction_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    entryType: row.entry_type,
    allocatedAmountPaise: row.allocated_amount_paise,
    allocationMethod: row.allocation_method,
    reversedAllocationId: row.reversed_allocation_id,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createImportBatch(
  input: {
    businessId: string;
    sourceType: RecordOrigin;
    filename: string | null;
    totalRows: number;
  },
  client?: PoolClient,
): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO bank_import_batches (business_id, source_type, filename, status, total_rows)
     VALUES ($1, $2, $3, 'PROCESSING', $4)
     RETURNING id`,
    [input.businessId, input.sourceType, input.filename, input.totalRows],
    client,
  );
  return res.rows[0].id;
}

export async function finalizeImportBatch(
  batchId: string,
  counts: {
    status: ImportBatchDTO['status'];
    insertedRows: number;
    duplicateRows: number;
    errorRows: number;
    errorSummary: unknown[];
  },
  client?: PoolClient,
): Promise<void> {
  await query(
    `UPDATE bank_import_batches
        SET status = $2,
            inserted_rows = $3,
            duplicate_rows = $4,
            error_rows = $5,
            error_summary_json = $6::jsonb
      WHERE id = $1`,
    [
      batchId,
      counts.status,
      counts.insertedRows,
      counts.duplicateRows,
      counts.errorRows,
      JSON.stringify(counts.errorSummary),
    ],
    client,
  );
}

export async function listImportBatches(businessId: string, client?: PoolClient): Promise<ImportBatchDTO[]> {
  const res = await query<{
    id: string;
    business_id: string;
    source_type: RecordOrigin;
    filename: string | null;
    imported_at: Date;
    status: ImportBatchDTO['status'];
    total_rows: number;
    inserted_rows: number;
    duplicate_rows: number;
    error_rows: number;
    error_summary_json: unknown[];
  }>(
    'SELECT * FROM bank_import_batches WHERE business_id = $1 ORDER BY imported_at DESC LIMIT 25',
    [businessId],
    client,
  );

  return res.rows.map((r) => ({
    id: r.id,
    businessId: r.business_id,
    sourceType: r.source_type,
    filename: r.filename,
    importedAt: r.imported_at.toISOString(),
    status: r.status,
    totalRows: r.total_rows,
    insertedRows: r.inserted_rows,
    duplicateRows: r.duplicate_rows,
    errorRows: r.error_rows,
    errorSummary: r.error_summary_json,
  }));
}

export async function listPaymentTransactions(
  businessId: string,
  filters?: {
    fromDate?: string;
    toDate?: string;
    method?: PaymentMethod;
    matchStatus?: MatchStatus;
    allocationStatus?: PaymentTransactionDTO['allocationStatus'];
    direction?: PaymentDirection;
    retailerId?: string;
  },
  client?: PoolClient,
): Promise<PaymentTransactionDTO[]> {
  const conditions: string[] = ['pt.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filters?.fromDate) {
    params.push(filters.fromDate);
    conditions.push(`pt.value_date >= $${params.length}`);
  }
  if (filters?.toDate) {
    params.push(filters.toDate);
    conditions.push(`pt.value_date <= $${params.length}`);
  }
  if (filters?.method) {
    params.push(filters.method);
    conditions.push(`pt.payment_method = $${params.length}`);
  }
  if (filters?.matchStatus) {
    params.push(filters.matchStatus);
    conditions.push(`pt.match_status = $${params.length}`);
  }
  if (filters?.allocationStatus) {
    params.push(filters.allocationStatus);
    conditions.push(`pt.allocation_status = $${params.length}`);
  }
  if (filters?.direction) {
    params.push(filters.direction);
    conditions.push(`pt.direction = $${params.length}`);
  }
  if (filters?.retailerId) {
    params.push(filters.retailerId);
    conditions.push(`pt.matched_retailer_id = $${params.length}`);
  }

  const res = await query<PaymentTransactionRow>(
    `SELECT pt.*, r.retailer_code AS matched_retailer_code, r.name AS matched_retailer_name
       FROM payment_transactions pt
       LEFT JOIN retailers r ON r.id = pt.matched_retailer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pt.transaction_timestamp DESC, pt.created_at DESC`,
    params,
    client,
  );
  return res.rows.map(mapPayment);
}

export async function listRetailerCreditLedger(
  businessId: string,
  retailerId: string,
  client?: PoolClient,
) {
  const res = await query<{
    id: string;
    entry_type: string;
    amount_paise: string;
    payment_transaction_id: string | null;
    notes: string | null;
    created_at: Date;
  }>(
    `SELECT id, entry_type, amount_paise, payment_transaction_id, notes, created_at
       FROM retailer_credit_ledger
      WHERE business_id = $1 AND retailer_id = $2
      ORDER BY created_at DESC`,
    [businessId, retailerId],
    client,
  );
  return res.rows.map((r) => ({
    id: r.id,
    entryType: r.entry_type,
    amountPaise: r.amount_paise,
    paymentTransactionId: r.payment_transaction_id,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getPaymentTransactionById(
  businessId: string,
  paymentId: string,
  forUpdate = false,
  client?: PoolClient,
): Promise<PaymentTransactionDTO | null> {
  const lock = forUpdate ? ' FOR UPDATE OF pt' : '';
  const res = await query<PaymentTransactionRow>(
    `SELECT pt.*, r.retailer_code AS matched_retailer_code, r.name AS matched_retailer_name
       FROM payment_transactions pt
       LEFT JOIN retailers r ON r.id = pt.matched_retailer_id
      WHERE pt.id = $1 AND pt.business_id = $2${lock}`,
    [paymentId, businessId],
    client,
  );
  return res.rows[0] ? mapPayment(res.rows[0]) : null;
}

export async function insertPaymentTransactionIfUnique(
  input: {
    businessId: string;
    importBatchId: string | null;
    direction: PaymentDirection;
    paymentMethod: PaymentMethod;
    externalTransactionReference: string | null;
    explicitInvoiceReference: string | null;
    payerIdentifierFingerprint: string | null;
    payerIdentifierMasked: string | null;
    payerDisplayName: string | null;
    narration: string;
    amountPaise: string;
    transactionTimestamp: string;
    valueDate: string;
    transactionFingerprint: string;
    matchStatus: MatchStatus;
    matchedRetailerId: string | null;
    matchEvidence: MatchEvidence;
    sourceType: RecordOrigin;
    reversalOfTransactionId?: string | null;
  },
  client?: PoolClient,
): Promise<{ inserted: boolean; transaction: PaymentTransactionDTO | null }> {
  const existing = await query<PaymentTransactionRow>(
    `SELECT * FROM payment_transactions WHERE business_id = $1 AND transaction_fingerprint = $2 LIMIT 1`,
    [input.businessId, input.transactionFingerprint],
    client,
  );
  if (existing.rows.length > 0) {
    return { inserted: false, transaction: null };
  }

  const res = await query<PaymentTransactionRow>(
    `INSERT INTO payment_transactions (
      business_id, import_batch_id, direction, payment_method, external_transaction_reference,
      explicit_invoice_reference, payer_identifier_fingerprint, payer_identifier_masked,
      payer_display_name, narration, amount_paise, transaction_timestamp, value_date,
      transaction_fingerprint, match_status, matched_retailer_id, match_evidence_json,
      source_type, reversal_of_transaction_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19
    )
    ON CONFLICT (business_id, transaction_fingerprint) DO NOTHING
    RETURNING *`,
    [
      input.businessId,
      input.importBatchId,
      input.direction,
      input.paymentMethod,
      input.externalTransactionReference,
      input.explicitInvoiceReference,
      input.payerIdentifierFingerprint,
      input.payerIdentifierMasked,
      input.payerDisplayName,
      input.narration,
      input.amountPaise,
      input.transactionTimestamp,
      input.valueDate,
      input.transactionFingerprint,
      input.matchStatus,
      input.matchedRetailerId,
      JSON.stringify(input.matchEvidence),
      input.sourceType,
      input.reversalOfTransactionId ?? null,
    ],
    client,
  );

  if (res.rows.length === 0) {
    return { inserted: false, transaction: null };
  }
  return { inserted: true, transaction: mapPayment(res.rows[0]) };
}

export async function assignManualRetailerMatch(
  businessId: string,
  paymentId: string,
  retailerId: string,
  evidence: MatchEvidence,
  client?: PoolClient,
): Promise<PaymentTransactionDTO | null> {
  const res = await query<PaymentTransactionRow>(
    `UPDATE payment_transactions
        SET match_status = 'MATCHED',
            matched_retailer_id = $3,
            match_evidence_json = $4::jsonb
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
    [paymentId, businessId, retailerId, JSON.stringify(evidence)],
    client,
  );
  return res.rows[0] ? mapPayment(res.rows[0]) : null;
}

export async function listPaymentAllocations(
  businessId: string,
  paymentTransactionId?: string,
  client?: PoolClient,
): Promise<PaymentAllocationDTO[]> {
  if (paymentTransactionId) {
    const res = await query<PaymentAllocationRow>(
      `SELECT pa.*, ci.invoice_number
         FROM payment_allocations pa
         JOIN customer_invoices ci ON ci.id = pa.invoice_id
        WHERE pa.business_id = $1 AND pa.payment_transaction_id = $2
        ORDER BY pa.created_at ASC`,
      [businessId, paymentTransactionId],
      client,
    );
    return res.rows.map(mapAllocation);
  }
  const res = await query<PaymentAllocationRow>(
    `SELECT pa.*, ci.invoice_number
       FROM payment_allocations pa
       JOIN customer_invoices ci ON ci.id = pa.invoice_id
      WHERE pa.business_id = $1
      ORDER BY pa.created_at DESC`,
    [businessId],
    client,
  );
  return res.rows.map(mapAllocation);
}

export async function insertPaymentAllocation(
  input: {
    businessId: string;
    paymentTransactionId: string;
    invoiceId: string;
    entryType: 'ALLOCATION' | 'REVERSAL';
    allocatedAmountPaise: string;
    allocationMethod: AllocationMethod;
    reversedAllocationId?: string | null;
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<PaymentAllocationDTO> {
  const res = await query<PaymentAllocationRow>(
    `INSERT INTO payment_allocations (
      business_id, payment_transaction_id, invoice_id, entry_type,
      allocated_amount_paise, allocation_method, reversed_allocation_id, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      input.businessId,
      input.paymentTransactionId,
      input.invoiceId,
      input.entryType,
      input.allocatedAmountPaise,
      input.allocationMethod,
      input.reversedAllocationId ?? null,
      input.notes ?? null,
    ],
    client,
  );

  if (isMemoryDbActive()) {
    const delta = BigInt(input.allocatedAmountPaise);

    await query(
      `UPDATE payment_transactions
          SET allocated_amount_paise = allocated_amount_paise + $2,
              allocation_status = CASE
                WHEN allocated_amount_paise + $2 >= amount_paise THEN 'ALLOCATED'
                WHEN allocated_amount_paise + $2 > 0 THEN 'PARTIALLY_ALLOCATED'
                ELSE 'UNAPPLIED'
              END
        WHERE id = $1`,
      [input.paymentTransactionId, delta.toString()],
      client,
    );

    await query(
      `UPDATE customer_invoices
          SET paid_amount_paise = paid_amount_paise + $2,
              status = CASE
                WHEN paid_amount_paise + $2 >= total_amount_paise THEN 'PAID'
                WHEN paid_amount_paise + $2 > 0 THEN 'PARTIALLY_PAID'
                ELSE 'OPEN'
              END
        WHERE id = $1`,
      [input.invoiceId, delta.toString()],
      client,
    );
  }

  return mapAllocation(res.rows[0]);
}

export async function insertRetailerCreditEvent(
  input: {
    businessId: string;
    retailerId: string;
    paymentTransactionId: string | null;
    entryType: 'OVERPAYMENT_CREDIT' | 'CREDIT_APPLIED' | 'CREDIT_REVERSAL' | 'REFUND';
    amountPaise: string;
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<void> {
  await query(
    `INSERT INTO retailer_credit_ledger (
      business_id, retailer_id, payment_transaction_id, entry_type, amount_paise, notes
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.businessId,
      input.retailerId,
      input.paymentTransactionId,
      input.entryType,
      input.amountPaise,
      input.notes ?? null,
    ],
    client,
  );

  if (isMemoryDbActive()) {
    const delta = input.entryType === 'OVERPAYMENT_CREDIT' || input.entryType === 'CREDIT_REVERSAL'
      ? BigInt(input.amountPaise)
      : -BigInt(input.amountPaise);
    await query(
      `UPDATE retailers
          SET unapplied_credit_paise = unapplied_credit_paise + $2
        WHERE id = $1`,
      [input.retailerId, delta.toString()],
      client,
    );
  }
}

export async function recordAuditEvent(
  input: {
    businessId: string;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    actor?: string;
    payload?: Record<string, unknown>;
  },
  client?: PoolClient,
): Promise<void> {
  await query(
    `INSERT INTO audit_events (business_id, event_type, entity_type, entity_id, actor, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.businessId,
      input.eventType,
      input.entityType,
      input.entityId ?? null,
      input.actor ?? 'DISTRIBUTOR',
      JSON.stringify(input.payload ?? {}),
    ],
    client,
  );
}

export async function listAuditEvents(businessId: string, limit = 50, client?: PoolClient) {
  const res = await query<{
    id: string;
    business_id: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    actor: string;
    payload_json: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT * FROM audit_events WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [businessId, limit],
    client,
  );
  return res.rows.map((r) => ({
    id: r.id,
    businessId: r.business_id,
    eventType: r.event_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actor: r.actor,
    payload: r.payload_json,
    createdAt: r.created_at.toISOString(),
  }));
}

