import { Router } from 'express';
import {
  checkCreditSaleProtection,
  createCreditAgreement,
  listCreditAgreements,
} from '../../services/creditAgreementService.js';
import {
  acceptNegotiation,
  createNegotiationProposal,
  listNegotiations,
  rejectNegotiation,
  submitCounterOffer,
} from '../../services/negotiationService.js';
import { evaluateRetailerRiskProfiles } from '../../services/retailerRiskService.js';
import { asyncHandler, HttpError, resolveBusinessId } from './helpers.js';

export const creditRouter: Router = Router();

// Credit Agreements
creditRouter.get(
  '/credit-agreements',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const agreements = await listCreditAgreements(businessId);
    res.json(agreements);
  }),
);

creditRouter.post(
  '/credit-agreements',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { retailerId, creditLimitPaise, standardTermDays, gracePeriodDays, lateFeePct, notes } = req.body ?? {};
    if (!retailerId || !creditLimitPaise) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'retailerId and creditLimitPaise are required.');
    }
    const agr = await createCreditAgreement({
      businessId,
      retailerId,
      creditLimitPaise,
      standardTermDays,
      gracePeriodDays,
      lateFeePct,
      notes,
    });
    res.status(201).json(agr);
  }),
);

creditRouter.post(
  '/credit-agreements/check-sale',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { retailerId, requestedSalePaise } = req.body ?? {};
    if (!retailerId || !requestedSalePaise) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'retailerId and requestedSalePaise are required.');
    }
    const result = await checkCreditSaleProtection(businessId, retailerId, requestedSalePaise);
    res.json(result);
  }),
);

// Payment Negotiations
creditRouter.get(
  '/negotiations',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const negotiations = await listNegotiations(businessId);
    res.json(negotiations);
  }),
);

creditRouter.post(
  '/negotiations/propose',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const {
      customerInvoiceId,
      supplierBillId,
      counterpartyType,
      counterpartyId,
      counterpartyName,
      originalAmountPaise,
      originalDueDate,
      proposedAmountPaise,
      proposedDueDate,
      channel,
      initialMessage,
    } = req.body ?? {};

    if (!counterpartyType || !counterpartyId || !counterpartyName || !originalAmountPaise || !proposedAmountPaise || !proposedDueDate) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Missing required negotiation proposal fields.');
    }

    const neg = await createNegotiationProposal({
      businessId,
      customerInvoiceId,
      supplierBillId,
      counterpartyType,
      counterpartyId,
      counterpartyName,
      originalAmountPaise,
      originalDueDate: originalDueDate || new Date().toISOString().slice(0, 10),
      proposedAmountPaise,
      proposedDueDate,
      channel,
      initialMessage,
    });
    res.status(201).json(neg);
  }),
);

creditRouter.post(
  '/negotiations/:id/counter',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { counterOfferAmountPaise, counterOfferDueDate, messageText } = req.body ?? {};
    if (!counterOfferAmountPaise || !counterOfferDueDate) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'counterOfferAmountPaise and counterOfferDueDate are required.');
    }
    const actor = req.user?.fullName ?? 'Distributor Owner';
    await submitCounterOffer({
      negotiationId: String(req.params.id),
      businessId,
      counterOfferAmountPaise,
      counterOfferDueDate,
      messageText,
      actor,
    });
    res.json({ ok: true });
  }),
);

creditRouter.post(
  '/negotiations/:id/accept',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const actor = req.user?.fullName ?? 'Distributor Owner';
    await acceptNegotiation({
      negotiationId: String(req.params.id),
      businessId,
      actor,
    });
    res.json({ ok: true });
  }),
);

creditRouter.post(
  '/negotiations/:id/reject',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const actor = req.user?.fullName ?? 'Distributor Owner';
    await rejectNegotiation({
      negotiationId: String(req.params.id),
      businessId,
      actor,
      reason: req.body?.reason,
    });
    res.json({ ok: true });
  }),
);

// Retailer Risk Profiles
creditRouter.get(
  '/retailers/risk-profiles',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const profiles = await evaluateRetailerRiskProfiles(businessId);
    res.json(profiles);
  }),
);
