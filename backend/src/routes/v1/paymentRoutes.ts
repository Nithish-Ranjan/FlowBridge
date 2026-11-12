import { Router } from 'express';
import { z } from 'zod';
import {
  listPaymentAllocations,
  listPaymentTransactions,
} from '../../db/repositories/paymentRepo.js';
import { importBankTransactions } from '../../services/csvImportService.js';
import {
  confirmPaymentAllocation,
  previewPaymentAllocation,
  recordSinglePaymentTransaction,
  resolveManualMatch,
  reversePaymentTransaction,
} from '../../services/paymentService.js';
import {
  AllocatePaymentSchema,
  ImportBankTransactionsSchema,
  IsoDateSchema,
  ParsedBankRowSchema,
  ResolveMatchSchema,
  UuidSchema,
} from '../../validation/schemas.js';
import { HttpError, asyncHandler, parseUuidParam, resolveBusinessId } from './helpers.js';

const PaymentQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  method: z.enum(['UPI', 'BANK_TRANSFER', 'OTHER']).optional(),
  matchStatus: z.enum(['UNMATCHED', 'AMBIGUOUS', 'MATCHED']).optional(),
  allocationStatus: z
    .enum(['UNAPPLIED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'OVERPAYMENT_CREDITED', 'REVERSED'])
    .optional(),
  direction: z.enum(['INFLOW', 'OUTFLOW']).optional(),
  retailerId: UuidSchema.optional(),
});

const ReverseSchema = z.object({
  reason: z.string().min(3).max(300),
});

export function createPaymentRouter(): Router {
  const router = Router();

  router.post(
    '/imports/bank-transactions',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = ImportBankTransactionsSchema.parse(req.body);
      const summary = await importBankTransactions(businessId, {
        csvText: body.csvText,
        rows: body.rows?.map((r) => ({ ...r, sourceType: body.sourceType ?? 'CSV_IMPORT' })),
        filename: body.filename,
        sourceType: body.sourceType,
      });
      res.status(201).json(summary);
    }),
  );

  // Match queue MUST register before `/payments/:paymentId`
  router.get(
    '/payments/match-queue',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const all = await listPaymentTransactions(businessId);
      const queue = all.filter(
        (tx) => !tx.isReversed && (tx.matchStatus === 'UNMATCHED' || tx.matchStatus === 'AMBIGUOUS'),
      );
      res.json({ queue, total: queue.length });
    }),
  );

  router.get(
    '/payments',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const queryParams = PaymentQuerySchema.parse({
        from: typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined,
        to: typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined,
        method: typeof req.query.method === 'string' && req.query.method ? req.query.method : undefined,
        matchStatus:
          typeof req.query.matchStatus === 'string' && req.query.matchStatus
            ? req.query.matchStatus
            : undefined,
        allocationStatus:
          typeof req.query.allocationStatus === 'string' && req.query.allocationStatus
            ? req.query.allocationStatus
            : undefined,
        direction:
          typeof req.query.direction === 'string' && req.query.direction
            ? req.query.direction
            : undefined,
        retailerId:
          typeof req.query.retailerId === 'string' && req.query.retailerId
            ? req.query.retailerId
            : undefined,
      });

      const payments = await listPaymentTransactions(businessId, {
        fromDate: queryParams.from,
        toDate: queryParams.to,
        method: queryParams.method,
        matchStatus: queryParams.matchStatus,
        allocationStatus: queryParams.allocationStatus,
        direction: queryParams.direction,
        retailerId: queryParams.retailerId,
      });

      res.json({ payments });
    }),
  );

  router.post(
    '/payments/manual',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = ParsedBankRowSchema.parse(req.body);
      const result = await recordSinglePaymentTransaction(businessId, {
        ...body,
        sourceType: 'MANUAL_ENTRY',
      });
      if (result.duplicate) {
        throw new HttpError(
          409,
          'DUPLICATE_TRANSACTION',
          'Duplicate transaction fingerprint ignored; payment already recorded.',
        );
      }
      res.status(201).json({ transaction: result.transaction });
    }),
  );

  router.get(
    '/payments/:paymentId',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const paymentId = parseUuidParam(req.params.paymentId, 'paymentId');
      const payments = await listPaymentTransactions(businessId);
      const payment = payments.find((p) => p.id === paymentId);
      if (!payment) {
        throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment transaction not found.');
      }
      const allocations = await listPaymentAllocations(businessId, paymentId);

      let allocationPreview = null;
      if (
        payment.matchStatus === 'MATCHED' &&
        !payment.isReversed &&
        BigInt(payment.remainingToAllocatePaise) > 0n
      ) {
        allocationPreview = await previewPaymentAllocation(businessId, paymentId);
      }

      res.json({ payment, allocations, allocationPreview });
    }),
  );

  router.get(
    '/payments/:paymentId/allocation-preview',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const paymentId = parseUuidParam(req.params.paymentId, 'paymentId');
      const preview = await previewPaymentAllocation(businessId, paymentId);
      res.json({ preview });
    }),
  );

  router.post(
    '/payments/:paymentId/resolve-match',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const paymentId = parseUuidParam(req.params.paymentId, 'paymentId');
      const body = ResolveMatchSchema.parse(req.body);
      const result = await resolveManualMatch(
        businessId,
        paymentId,
        body.retailerId,
        body.note,
        body.allocations,
        body.creditRemainderAsOverpayment,
      );
      res.json(result);
    }),
  );

  router.post(
    '/payments/:paymentId/allocate',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const paymentId = parseUuidParam(req.params.paymentId, 'paymentId');
      const body = AllocatePaymentSchema.parse(req.body);
      const result = await confirmPaymentAllocation(
        businessId,
        paymentId,
        body.allocations,
        body.creditRemainderAsOverpayment,
        body.notes,
      );
      res.json(result);
    }),
  );

  router.post(
    '/payments/:paymentId/reverse',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const paymentId = parseUuidParam(req.params.paymentId, 'paymentId');
      const body = ReverseSchema.parse(req.body);
      const result = await reversePaymentTransaction(businessId, paymentId, body.reason);
      res.json(result);
    }),
  );

  return router;
}
