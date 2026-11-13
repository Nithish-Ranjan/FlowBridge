import type { PoolClient } from 'pg';
import type {
  CustomerInvoiceDTO,
  OperatingExpenseDTO,
  RecordOrigin,
  SupplierBillDTO,
} from '@flowbridge/shared';
import { parsePaise, paiseToString } from '@flowbridge/shared';
import { query } from '../pool.js';

function toIsoDateString(val: string | Date | unknown): string {
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val ?? '');
}

interface InvoiceRow {
  id: string;
  business_id: string;
  retailer_id: string;
  retailer_code?: string;
  retailer_name?: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total_amount_paise: string;
  paid_amount_paise: string;
  status: CustomerInvoiceDTO['status'];
  evidence_status: CustomerInvoiceDTO['evidenceStatus'];
  external_reference: string | null;
  record_origin: RecordOrigin;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface BillRow {
  id: string;
  business_id: string;
  supplier_id: string;
  supplier_code?: string;
  supplier_name?: string;
  bill_number: string;
  issue_date: string;
  due_date: string;
  total_amount_paise: string;
  paid_amount_paise: string;
  status: SupplierBillDTO['status'];
  evidence_status: SupplierBillDTO['evidenceStatus'];
  priority_tier: SupplierBillDTO['priorityTier'];
  record_origin: RecordOrigin;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ExpenseRow {
  id: string;
  business_id: string;
  expense_code: string;
  category: string;
  description: string;
  due_date: string;
  amount_paise: string;
  paid_amount_paise: string;
  status: OperatingExpenseDTO['status'];
  priority_tier: OperatingExpenseDTO['priorityTier'];
  is_protected: boolean;
  record_origin: RecordOrigin;
  created_at: Date;
  updated_at: Date;
}

function mapInvoice(row: InvoiceRow): CustomerInvoiceDTO {
  const outstanding = parsePaise(row.total_amount_paise) - parsePaise(row.paid_amount_paise);
  return {
    id: row.id,
    businessId: row.business_id,
    retailerId: row.retailer_id,
    retailerCode: row.retailer_code,
    retailerName: row.retailer_name,
    invoiceNumber: row.invoice_number,
    invoiceDate: toIsoDateString(row.invoice_date),
    dueDate: toIsoDateString(row.due_date),
    totalAmountPaise: String(row.total_amount_paise),
    paidAmountPaise: String(row.paid_amount_paise),
    outstandingPaise: paiseToString(outstanding),
    status: row.status,
    evidenceStatus: row.evidence_status,
    externalReference: row.external_reference,
    recordOrigin: row.record_origin,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapBill(row: BillRow): SupplierBillDTO {
  const outstanding = parsePaise(row.total_amount_paise) - parsePaise(row.paid_amount_paise);
  return {
    id: row.id,
    businessId: row.business_id,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    billNumber: row.bill_number,
    issueDate: toIsoDateString(row.issue_date),
    dueDate: toIsoDateString(row.due_date),
    totalAmountPaise: String(row.total_amount_paise),
    paidAmountPaise: String(row.paid_amount_paise),
    outstandingPaise: paiseToString(outstanding),
    status: row.status,
    evidenceStatus: row.evidence_status,
    priorityTier: row.priority_tier,
    recordOrigin: row.record_origin,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapExpense(row: ExpenseRow): OperatingExpenseDTO {
  const outstanding = parsePaise(row.amount_paise) - parsePaise(row.paid_amount_paise);
  return {
    id: row.id,
    businessId: row.business_id,
    expenseCode: row.expense_code,
    category: row.category,
    description: row.description,
    dueDate: toIsoDateString(row.due_date),
    amountPaise: String(row.amount_paise),
    paidAmountPaise: String(row.paid_amount_paise),
    outstandingPaise: paiseToString(outstanding),
    status: row.status,
    priorityTier: row.priority_tier,
    isProtected: row.is_protected,
    recordOrigin: row.record_origin,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCustomerInvoices(
  businessId: string,
  client?: PoolClient,
): Promise<CustomerInvoiceDTO[]> {
  const res = await query<InvoiceRow>(
    `SELECT ci.*, r.retailer_code, r.name AS retailer_name
       FROM customer_invoices ci
       JOIN retailers r ON r.id = ci.retailer_id
      WHERE ci.business_id = $1
      ORDER BY ci.due_date ASC, ci.invoice_number ASC`,
    [businessId],
    client,
  );
  return res.rows.map(mapInvoice);
}

export async function listOpenInvoicesForRetailer(
  businessId: string,
  retailerId: string,
  forUpdate = false,
  client?: PoolClient,
): Promise<CustomerInvoiceDTO[]> {
  const lockClause = forUpdate ? ' FOR UPDATE OF ci' : '';
  const res = await query<InvoiceRow>(
    `SELECT ci.*, r.retailer_code, r.name AS retailer_name
       FROM customer_invoices ci
       JOIN retailers r ON r.id = ci.retailer_id
      WHERE ci.business_id = $1
        AND ci.retailer_id = $2
        AND ci.status IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
        AND ci.paid_amount_paise < ci.total_amount_paise
      ORDER BY ci.due_date ASC, ci.invoice_number ASC${lockClause}`,
    [businessId, retailerId],
    client,
  );
  return res.rows.map(mapInvoice);
}

export async function findInvoicesByExplicitReference(
  businessId: string,
  referenceToken: string,
  client?: PoolClient,
): Promise<CustomerInvoiceDTO[]> {
  const normalized = referenceToken.trim().toUpperCase();
  if (!normalized) return [];
  const res = await query<InvoiceRow>(
    `SELECT ci.*, r.retailer_code, r.name AS retailer_name
       FROM customer_invoices ci
       JOIN retailers r ON r.id = ci.retailer_id
      WHERE ci.business_id = $1
        AND (upper(ci.invoice_number) = $2 OR upper(COALESCE(ci.external_reference, '')) = $2)`,
    [businessId, normalized],
    client,
  );
  return res.rows.map(mapInvoice);
}

export async function createCustomerInvoice(
  input: {
    businessId: string;
    retailerId: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmountPaise: string;
    evidenceStatus?: CustomerInvoiceDTO['evidenceStatus'];
    externalReference?: string | null;
    recordOrigin?: RecordOrigin;
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<CustomerInvoiceDTO> {
  const res = await query<InvoiceRow>(
    `INSERT INTO customer_invoices (
      business_id, retailer_id, invoice_number, invoice_date, due_date, total_amount_paise,
      evidence_status, external_reference, record_origin, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.businessId,
      input.retailerId,
      input.invoiceNumber,
      input.invoiceDate,
      input.dueDate,
      input.totalAmountPaise,
      input.evidenceStatus ?? 'UNCONFIRMED',
      input.externalReference ?? input.invoiceNumber,
      input.recordOrigin ?? 'MANUAL_ENTRY',
      input.notes ?? null,
    ],
    client,
  );
  return mapInvoice(res.rows[0]);
}

export async function getInvoiceById(
  businessId: string,
  invoiceId: string,
  client?: PoolClient,
): Promise<CustomerInvoiceDTO | null> {
  const res = await query<InvoiceRow>(
    `SELECT ci.*, r.retailer_code, r.name AS retailer_name
       FROM customer_invoices ci
       JOIN retailers r ON r.id = ci.retailer_id
      WHERE ci.id = $1 AND ci.business_id = $2`,
    [invoiceId, businessId],
    client,
  );
  return res.rows[0] ? mapInvoice(res.rows[0]) : null;
}

export async function updateInvoiceFields(
  businessId: string,
  invoiceId: string,
  patch: {
    dueDate?: string;
    evidenceStatus?: CustomerInvoiceDTO['evidenceStatus'];
    status?: 'CANCELLED' | 'WRITTEN_OFF';
    externalReference?: string | null;
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<CustomerInvoiceDTO | null> {
  const existing = await getInvoiceById(businessId, invoiceId, client);
  if (!existing) return null;
  if (patch.status && parsePaise(existing.paidAmountPaise) > 0n) {
    throw new Error('Cannot cancel or write off an invoice that already has allocated receipts; reverse allocations first.');
  }
  const res = await query<InvoiceRow>(
    `UPDATE customer_invoices
        SET due_date = $3,
            evidence_status = $4,
            status = $5,
            external_reference = $6,
            notes = $7
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
    [
      invoiceId,
      businessId,
      patch.dueDate ?? existing.dueDate,
      patch.evidenceStatus ?? existing.evidenceStatus,
      patch.status ?? existing.status,
      patch.externalReference !== undefined ? patch.externalReference : existing.externalReference,
      patch.notes !== undefined ? patch.notes : existing.notes,
    ],
    client,
  );
  return res.rows[0] ? getInvoiceById(businessId, res.rows[0].id, client) : null;
}

export async function updateInvoiceEvidenceStatus(
  businessId: string,
  invoiceId: string,
  evidenceStatus: CustomerInvoiceDTO['evidenceStatus'],
  client?: PoolClient,
): Promise<CustomerInvoiceDTO | null> {
  const res = await query<InvoiceRow>(
    `UPDATE customer_invoices
        SET evidence_status = $3
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
    [invoiceId, businessId, evidenceStatus],
    client,
  );
  return res.rows[0] ? mapInvoice(res.rows[0]) : null;
}

export async function listSupplierBills(
  businessId: string,
  client?: PoolClient,
): Promise<SupplierBillDTO[]> {
  const res = await query<BillRow>(
    `SELECT sb.*, s.supplier_code, s.name AS supplier_name
       FROM supplier_bills sb
       JOIN suppliers s ON s.id = sb.supplier_id
      WHERE sb.business_id = $1
      ORDER BY sb.due_date ASC, sb.bill_number ASC`,
    [businessId],
    client,
  );
  return res.rows.map(mapBill);
}

export async function createSupplierBill(
  input: {
    businessId: string;
    supplierId: string;
    billNumber: string;
    issueDate: string;
    dueDate: string;
    totalAmountPaise: string;
    priorityTier?: SupplierBillDTO['priorityTier'];
    recordOrigin?: RecordOrigin;
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<SupplierBillDTO> {
  const res = await query<BillRow>(
    `INSERT INTO supplier_bills (
      business_id, supplier_id, bill_number, issue_date, due_date, total_amount_paise,
      priority_tier, record_origin, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.businessId,
      input.supplierId,
      input.billNumber,
      input.issueDate,
      input.dueDate,
      input.totalAmountPaise,
      input.priorityTier ?? 'NORMAL',
      input.recordOrigin ?? 'MANUAL_ENTRY',
      input.notes ?? null,
    ],
    client,
  );
  return mapBill(res.rows[0]);
}

export async function listOperatingExpenses(
  businessId: string,
  client?: PoolClient,
): Promise<OperatingExpenseDTO[]> {
  const res = await query<ExpenseRow>(
    `SELECT * FROM operating_expenses
      WHERE business_id = $1
      ORDER BY due_date ASC, expense_code ASC`,
    [businessId],
    client,
  );
  return res.rows.map(mapExpense);
}

export async function createOperatingExpense(
  input: {
    businessId: string;
    expenseCode: string;
    category: string;
    description: string;
    dueDate: string;
    amountPaise: string;
    priorityTier?: OperatingExpenseDTO['priorityTier'];
    isProtected?: boolean;
    recordOrigin?: RecordOrigin;
  },
  client?: PoolClient,
): Promise<OperatingExpenseDTO> {
  const res = await query<ExpenseRow>(
    `INSERT INTO operating_expenses (
      business_id, expense_code, category, description, due_date, amount_paise,
      priority_tier, is_protected, record_origin
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.businessId,
      input.expenseCode,
      input.category,
      input.description,
      input.dueDate,
      input.amountPaise,
      input.priorityTier ?? 'ESSENTIAL',
      input.isProtected ?? true,
      input.recordOrigin ?? 'MANUAL_ENTRY',
    ],
    client,
  );
  return mapExpense(res.rows[0]);
}

