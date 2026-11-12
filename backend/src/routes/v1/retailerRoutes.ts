import { Router } from 'express';
import { maskPaymentIdentifier, parsePaise, paiseToString } from '@flowbridge/shared';
import { getEnv } from '../../config/env.js';
import { listCustomerInvoices } from '../../db/repositories/ledgerRepo.js';
import {
  listPaymentAllocations,
  listPaymentTransactions,
  listRetailerCreditLedger,
  recordAuditEvent,
} from '../../db/repositories/paymentRepo.js';
import {
  createRetailer,
  getRetailerById,
  listPaymentIdentifiers,
  listRetailers,
  registerPaymentIdentifier,
  updatePaymentIdentifier,
  updateRetailer,
} from '../../db/repositories/retailerRepo.js';
import { computeIdentifierHmac } from '../../utils/crypto.js';
import {
  IdentifierCreateSchema,
  IdentifierUpdateSchema,
  RetailerCreateSchema,
  RetailerUpdateSchema,
} from '../../validation/schemas.js';
import { HttpError, asyncHandler, parseUuidParam, resolveBusinessId } from './helpers.js';

export function createRetailerRouter(): Router {
  const router = Router();

  router.get(
    '/retailers',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailers = await listRetailers(businessId);
      res.json({ retailers });
    }),
  );

  router.post(
    '/retailers',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = RetailerCreateSchema.parse(req.body);
      const retailer = await createRetailer({ businessId, ...body });
      await recordAuditEvent({
        businessId,
        eventType: 'RETAILER_CREATED',
        entityType: 'retailers',
        entityId: retailer.id,
        actor: 'DISTRIBUTOR',
        payload: { retailerCode: retailer.retailerCode },
      });
      res.status(201).json({ retailer });
    }),
  );

  router.get(
    '/retailers/:retailerId',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const retailer = await getRetailerById(businessId, retailerId);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found.');
      }
      const identifiers = await listPaymentIdentifiers(businessId, retailerId);
      res.json({ retailer, identifiers });
    }),
  );

  router.patch(
    '/retailers/:retailerId',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const body = RetailerUpdateSchema.parse(req.body);
      const retailer = await updateRetailer(businessId, retailerId, body);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found.');
      }
      res.json({ retailer });
    }),
  );

  router.get(
    '/retailers/:retailerId/payment-identifiers',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const retailer = await getRetailerById(businessId, retailerId);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found.');
      }
      const identifiers = await listPaymentIdentifiers(businessId, retailerId);
      res.json({ identifiers });
    }),
  );

  router.post(
    '/retailers/:retailerId/payment-identifiers',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const retailer = await getRetailerById(businessId, retailerId);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found.');
      }

      const body = IdentifierCreateSchema.parse(req.body);
      const env = getEnv();
      const normalizedFingerprint = computeIdentifierHmac(
        body.identifierType,
        body.rawValue,
        env.IDENTIFIER_HMAC_SECRET,
      );
      const maskedValue = maskPaymentIdentifier(body.identifierType, body.rawValue);

      const identifier = await registerPaymentIdentifier({
        businessId,
        retailerId,
        identifierType: body.identifierType,
        normalizedFingerprint,
        maskedValue,
        displayLabel: body.displayLabel,
        verified: body.verified,
      });

      await recordAuditEvent({
        businessId,
        eventType: 'PAYMENT_IDENTIFIER_REGISTERED',
        entityType: 'retailer_payment_identifiers',
        entityId: identifier.id,
        actor: 'DISTRIBUTOR',
        payload: {
          retailerId,
          identifierType: identifier.identifierType,
          maskedValue: identifier.maskedValue,
        },
      });

      res.status(201).json({ identifier });
    }),
  );

  router.patch(
    '/retailers/:retailerId/payment-identifiers/:identifierId',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const identifierId = parseUuidParam(req.params.identifierId, 'identifierId');
      const body = IdentifierUpdateSchema.parse(req.body);

      const identifier = await updatePaymentIdentifier(businessId, retailerId, identifierId, body);
      if (!identifier) {
        throw new HttpError(404, 'IDENTIFIER_NOT_FOUND', 'Payment identifier not found.');
      }
      await recordAuditEvent({
        businessId,
        eventType: 'PAYMENT_IDENTIFIER_UPDATED',
        entityType: 'retailer_payment_identifiers',
        entityId: identifier.id,
        actor: 'DISTRIBUTOR',
        payload: {
          isActive: identifier.isActive,
          verified: identifier.verifiedAt !== null,
        },
      });
      res.json({ identifier });
    }),
  );

  router.get(
    '/retailers/:retailerId/ledger',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const retailer = await getRetailerById(businessId, retailerId);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found.');
      }

      const [allInvoices, payments, allAllocations, creditEvents] = await Promise.all([
        listCustomerInvoices(businessId),
        listPaymentTransactions(businessId, { retailerId }),
        listPaymentAllocations(businessId),
        listRetailerCreditLedger(businessId, retailerId),
      ]);

      const invoices = allInvoices.filter((inv) => inv.retailerId === retailerId);
      const invoiceIdSet = new Set(invoices.map((i) => i.id));
      const allocatedReceipts = allAllocations.filter((a) => invoiceIdSet.has(a.invoiceId));

      let totalInvoiced = 0n;
      let totalPaid = 0n;
      let outstandingBalance = 0n;
      for (const inv of invoices) {
        if (inv.status === 'CANCELLED' || inv.status === 'WRITTEN_OFF') continue;
        totalInvoiced += parsePaise(inv.totalAmountPaise);
        totalPaid += parsePaise(inv.paidAmountPaise);
        outstandingBalance += parsePaise(inv.outstandingPaise);
      }

      res.json({
        retailer,
        invoices,
        payments,
        allocatedReceipts,
        totalInvoicedPaise: paiseToString(totalInvoiced),
        totalCollectedPaise: paiseToString(totalPaid),
        outstandingBalancePaise: paiseToString(outstandingBalance),
        unappliedCreditPaise: retailer.unappliedCreditPaise,
        creditEvents,
      });
    }),
  );

  router.get(
    '/retailers/:retailerId/payment-history',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const retailerId = parseUuidParam(req.params.retailerId, 'retailerId');
      const retailer = await getRetailerById(businessId, retailerId);
      if (!retailer) {
        throw new HttpError(404, 'RETAILER_NOT_FOUND', 'Retailer not found.');
      }

      const [payments, allAllocations, creditEvents] = await Promise.all([
        listPaymentTransactions(businessId, { retailerId }),
        listPaymentAllocations(businessId),
        listRetailerCreditLedger(businessId, retailerId),
      ]);
      const paymentIds = new Set(payments.map((p) => p.id));
      const allocations = allAllocations.filter((a) => paymentIds.has(a.paymentTransactionId));

      res.json({
        retailer,
        payments,
        allocations,
        creditEvents,
      });
    }),
  );

  return router;
}

