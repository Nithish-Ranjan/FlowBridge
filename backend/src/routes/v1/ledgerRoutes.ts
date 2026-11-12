import { Router } from 'express';
import { parseIsoDate } from '@flowbridge/shared';
import { createSupplier, listSuppliers } from '../../db/repositories/businessRepo.js';
import {
  createCustomerInvoice,
  createOperatingExpense,
  createSupplierBill,
  getInvoiceById,
  listCustomerInvoices,
  listOperatingExpenses,
  listSupplierBills,
  updateInvoiceFields,
} from '../../db/repositories/ledgerRepo.js';
import { listPaymentAllocations, recordAuditEvent } from '../../db/repositories/paymentRepo.js';
import { getRetailerById } from '../../db/repositories/retailerRepo.js';
import { getChasePriorityBeforeDate } from '../../services/engineService.js';
import {
  BillCreateSchema,
  ExpenseCreateSchema,
  InvoiceCreateSchema,
  InvoiceUpdateSchema,
  SupplierCreateSchema,
} from '../../validation/schemas.js';
import { HttpError, asyncHandler, parseUuidParam, resolveBusinessId } from './helpers.js';

export function createLedgerRouter(): Router {
  const router = Router();

  // Chase priority MUST register before `/invoices/:id`
  router.get(
    '/invoices/chase-priority',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const beforeDate =
        typeof req.query.beforeDate === 'string' && req.query.beforeDate
          ? parseIsoDate(req.query.beforeDate)
          : undefined;
      const result = await getChasePriorityBeforeDate(businessId, beforeDate);
      res.json(result);
    }),
  );

  router.get(
    '/invoices',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const invoices = await listCustomerInvoices(businessId);
      res.json({ invoices });
    }),
  );

  router.post(
    '/invoices',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = InvoiceCreateSchema.parse(req.body);
      const retailer = await getRetailerById(businessId, body.retailerId);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found in this business.');
      }
      const invoice = await createCustomerInvoice({
        businessId,
        ...body,
      });
      await recordAuditEvent({
        businessId,
        eventType: 'INVOICE_CREATED',
        entityType: 'customer_invoices',
        entityId: invoice.id,
        actor: 'DISTRIBUTOR',
        payload: { invoiceNumber: invoice.invoiceNumber, totalAmountPaise: invoice.totalAmountPaise },
      });
      res.status(201).json({ invoice });
    }),
  );

  router.get(
    '/invoices/:id',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const invoiceId = parseUuidParam(req.params.id, 'id');
      const invoice = await getInvoiceById(businessId, invoiceId);
      if (!invoice) {
        throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Customer invoice not found.');
      }
      const allAllocations = await listPaymentAllocations(businessId);
      const allocations = allAllocations.filter((a) => a.invoiceId === invoiceId);
      res.json({ invoice, allocations });
    }),
  );

  router.patch(
    '/invoices/:id',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const invoiceId = parseUuidParam(req.params.id, 'id');
      const body = InvoiceUpdateSchema.parse(req.body);
      const invoice = await updateInvoiceFields(businessId, invoiceId, body);
      if (!invoice) {
        throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Customer invoice not found.');
      }
      await recordAuditEvent({
        businessId,
        eventType: 'INVOICE_UPDATED',
        entityType: 'customer_invoices',
        entityId: invoice.id,
        actor: 'DISTRIBUTOR',
        payload: body,
      });
      res.json({ invoice });
    }),
  );

  router.get(
    '/suppliers',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const suppliers = await listSuppliers(businessId);
      res.json({ suppliers });
    }),
  );

  router.post(
    '/suppliers',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = SupplierCreateSchema.parse(req.body);
      const supplier = await createSupplier({ businessId, ...body });
      res.status(201).json({ supplier });
    }),
  );

  router.get(
    '/supplier-bills',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const bills = await listSupplierBills(businessId);
      res.json({ bills });
    }),
  );

  router.post(
    '/supplier-bills',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = BillCreateSchema.parse(req.body);
      const suppliers = await listSuppliers(businessId);
      if (!suppliers.some((s) => s.id === body.supplierId)) {
        throw new HttpError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found in this business.');
      }
      const bill = await createSupplierBill({ businessId, ...body });
      res.status(201).json({ bill });
    }),
  );

  router.get(
    '/expenses',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const expenses = await listOperatingExpenses(businessId);
      res.json({ expenses });
    }),
  );

  router.post(
    '/expenses',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = ExpenseCreateSchema.parse(req.body);
      const expense = await createOperatingExpense({ businessId, ...body });
      res.status(201).json({ expense });
    }),
  );

  return router;
}

