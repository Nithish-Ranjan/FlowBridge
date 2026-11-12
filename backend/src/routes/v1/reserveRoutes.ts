import { Router } from 'express';
import {
  depositToReserve,
  getReserveStatus,
  updateReserveSettings,
  withdrawFromReserve,
} from '../../services/reserveService.js';
import { asyncHandler, HttpError, resolveBusinessId } from './helpers.js';

export const reserveRouter: Router = Router();

reserveRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const data = await getReserveStatus(businessId);
    res.json(data);
  }),
);

reserveRouter.post(
  '/settings',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { targetReservePaise, minimumThresholdPaise } = req.body ?? {};
    if (!targetReservePaise || !minimumThresholdPaise) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'targetReservePaise and minimumThresholdPaise are required');
    }
    await updateReserveSettings({ businessId, targetReservePaise, minimumThresholdPaise });
    const data = await getReserveStatus(businessId);
    res.json(data);
  }),
);

reserveRouter.post(
  '/deposit',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { amountPaise, reason } = req.body ?? {};
    if (!amountPaise) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'amountPaise is required');
    }
    const actor = req.user?.fullName ?? 'Owner / Authorized Desk';
    const reserve = await depositToReserve({
      businessId,
      amountPaise,
      authorizedBy: actor,
      reason: reason || 'Standard Reserve Top-up',
    });
    res.json(reserve);
  }),
);

reserveRouter.post(
  '/withdraw',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { amountPaise, reason } = req.body ?? {};
    if (!amountPaise || !reason) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'amountPaise and reason are required for emergency withdrawal');
    }
    const actor = req.user?.fullName ?? 'Owner / Authorized Desk';
    const reserve = await withdrawFromReserve({
      businessId,
      amountPaise,
      authorizedBy: actor,
      reason,
    });
    res.json(reserve);
  }),
);
