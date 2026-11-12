import { Router } from 'express';
import { parseIsoDate } from '@flowbridge/shared';
import {
  createBusiness,
  getBusinessById,
  listBusinesses,
  updateBusinessSettings,
} from '../../db/repositories/businessRepo.js';
import { recordAuditEvent } from '../../db/repositories/paymentRepo.js';
import {
  getDashboardSummary,
  loadBusinessWorkspace,
  runBoundedResolutionSearch,
  runForecast,
  runVerificationAndRadar,
} from '../../services/engineService.js';
import { BusinessCreateSchema, BusinessSettingsSchema } from '../../validation/schemas.js';
import { HttpError, asyncHandler, parseUuidParam, resolveBusinessId } from './helpers.js';

export function createBusinessRouter(): Router {
  const router = Router();

  router.get(
    '/business',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const business = await getBusinessById(businessId);
      if (!business) {
        throw new HttpError(404, 'BUSINESS_NOT_FOUND', 'Business not found.');
      }
      res.json({ business });
    }),
  );

  router.patch(
    '/business/settings',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = BusinessSettingsSchema.parse(req.body);
      const updated = await updateBusinessSettings(businessId, body);
      if (!updated) {
        throw new HttpError(404, 'BUSINESS_NOT_FOUND', 'Business not found.');
      }
      await recordAuditEvent({
        businessId,
        eventType: 'BUSINESS_SETTINGS_UPDATED',
        entityType: 'businesses',
        entityId: businessId,
        actor: 'DISTRIBUTOR',
        payload: {
          openingCashDate: updated.openingCashDate,
          openingCashPaise: updated.openingCashPaise,
          minimumCashPaise: updated.minimumCashPaise,
          allocationPolicy: updated.allocationPolicy,
        },
      });
      res.json({ business: updated });
    }),
  );

  router.get(
    '/dashboard/summary',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const rawHorizon = req.query.horizonDays ? Number(req.query.horizonDays) : 15;
      if (!Number.isInteger(rawHorizon) || rawHorizon < 1 || rawHorizon > 180) {
        throw new HttpError(400, 'INVALID_HORIZON', 'horizonDays must be an integer between 1 and 180.');
      }
      const summary = await getDashboardSummary(businessId, rawHorizon);
      res.json(summary);
    }),
  );

  router.get(
    '/businesses',
    asyncHandler(async (_req, res) => {
      const businesses = await listBusinesses();
      res.json({ businesses });
    }),
  );

  router.post(
    '/businesses',
    asyncHandler(async (req, res) => {
      const body = BusinessCreateSchema.parse(req.body);
      const business = await createBusiness(body);
      res.status(201).json({ business });
    }),
  );

  router.get(
    '/businesses/:businessId/dashboard',
    asyncHandler(async (req, res) => {
      const businessId = parseUuidParam(req.params.businessId, 'businessId');
      const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 15;
      if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 180) {
        throw new HttpError(400, 'INVALID_HORIZON', 'horizonDays must be an integer between 1 and 180.');
      }
      const asOfDate =
        typeof req.query.asOfDate === 'string' && req.query.asOfDate
          ? parseIsoDate(req.query.asOfDate)
          : undefined;

      const [workspace, forecast, resolution, verification] = await Promise.all([
        loadBusinessWorkspace(businessId),
        runForecast(businessId, { asOfDate, horizonDays }),
        runBoundedResolutionSearch(businessId, { asOfDate, horizonDays }),
        runVerificationAndRadar(businessId, { asOfDate, horizonDays: Math.max(horizonDays, 16) }),
      ]);

      res.json({
        workspace,
        forecast,
        resolution,
        verification,
      });
    }),
  );

  return router;
}

