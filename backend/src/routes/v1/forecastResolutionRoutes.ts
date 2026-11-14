import { Router } from 'express';
import { z } from 'zod';
import { validateScenarioActions } from '@flowbridge/shared';
import { updateBusinessSettings } from '../../db/repositories/businessRepo.js';
import {
  getForecastSnapshotById,
  getResolutionScenarioById,
  listResolutionScenarios,
} from '../../db/repositories/commitmentScenarioRepo.js';
import { recordAuditEvent } from '../../db/repositories/paymentRepo.js';
import {
  getForecastByRange,
  loadBusinessWorkspace,
  recalculateAndSaveSnapshot,
  runBoundedResolutionSearch,
  runForecast,
  saveWhatIfScenario,
} from '../../services/engineService.js';
import {
  ApprovalLimitsSchema,
  IsoDateSchema,
  ScenarioCreateSchema,
  UuidSchema,
} from '../../validation/schemas.js';
import { HttpError, asyncHandler, parseUuidParam, resolveBusinessId } from './helpers.js';

const RecalculateSchema = z.object({
  asOfDate: IsoDateSchema.optional(),
  horizonDays: z.number().int().min(1).max(180).default(15),
  snapshotLabel: z.string().max(120).optional(),
  scenarioId: UuidSchema.optional().nullable(),
});

const ResolutionRunSchema = z.object({
  asOfDate: IsoDateSchema.optional(),
  horizonDays: z.number().int().min(1).max(180).default(15),
});

const EvaluateScenarioSchema = z.object({
  asOfDate: IsoDateSchema.optional(),
  horizonDays: z.number().int().min(1).max(180).default(15),
  actions: ScenarioCreateSchema.shape.actions,
});

export function createForecastResolutionRouter(): Router {
  const router = Router();

  // Specific `/forecast/recalculate` MUST register before `/forecast/:snapshotId`
  router.post(
    '/forecast/recalculate',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = RecalculateSchema.parse(req.body ?? {});
      const result = await recalculateAndSaveSnapshot(businessId, body);
      res.status(201).json(result);
    }),
  );

  router.get(
    '/forecast',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const from = typeof req.query.from === 'string' && req.query.from ? IsoDateSchema.parse(req.query.from) : undefined;
      const to = typeof req.query.to === 'string' && req.query.to ? IsoDateSchema.parse(req.query.to) : undefined;
      const scenarioId =
        typeof req.query.scenarioId === 'string' && req.query.scenarioId
          ? UuidSchema.parse(req.query.scenarioId)
          : null;

      const result = await getForecastByRange(businessId, { from, to, scenarioId });
      res.json(result);
    }),
  );

  router.get(
    '/forecast/:snapshotId',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const snapshotId = parseUuidParam(req.params.snapshotId, 'snapshotId');
      const snapshot = await getForecastSnapshotById(businessId, snapshotId);
      if (!snapshot) {
        throw new HttpError(404, 'SNAPSHOT_NOT_FOUND', 'Forecast snapshot not found.');
      }
      res.json({ snapshot });
    }),
  );

  router.post(
    '/resolution/limits',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const limits = ApprovalLimitsSchema.parse(req.body);
      const business = await updateBusinessSettings(businessId, { approvalLimits: limits });
      if (!business) {
        throw new HttpError(404, 'BUSINESS_NOT_FOUND', 'Business not found.');
      }
      await recordAuditEvent({
        businessId,
        eventType: 'RESOLUTION_LIMITS_UPDATED',
        entityType: 'businesses',
        entityId: businessId,
        actor: 'DISTRIBUTOR',
        payload: limits,
      });
      res.json({ business });
    }),
  );

  router.post(
    '/resolution/run',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = ResolutionRunSchema.parse(req.body ?? {});
      const resolution = await runBoundedResolutionSearch(businessId, body);
      res.json({ resolution });
    }),
  );

  router.post(
    '/scenarios/evaluate',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = EvaluateScenarioSchema.parse(req.body);

      // Validate actions against live business records, amounts, and limits
      const ws = await loadBusinessWorkspace(businessId);
      const asOfDate = body.asOfDate ?? ws.business.openingCashDate;
      const validation = validateScenarioActions(body.actions, {
        invoices: ws.invoices,
        bills: ws.bills,
        expenses: ws.expenses,
        asOfDate,
        horizonDays: body.horizonDays,
        limits: ws.business.approvalLimits,
      });

      if (!validation.valid) {
        throw new HttpError(400, 'INVALID_SCENARIO_ACTIONS', validation.error || 'Invalid scenario actions.');
      }

      const forecast = await runForecast(businessId, {
        asOfDate: body.asOfDate,
        horizonDays: body.horizonDays,
        scenarioActions: body.actions,
      });
      res.json({ forecast });
    }),
  );

  router.get(
    '/scenarios',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const scenarios = await listResolutionScenarios(businessId);
      res.json({ scenarios });
    }),
  );

  router.post(
    '/scenarios',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = ScenarioCreateSchema.parse(req.body);
      const result = await saveWhatIfScenario(businessId, body);
      res.status(201).json(result);
    }),
  );

  router.get(
    '/scenarios/:id',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const scenarioId = parseUuidParam(req.params.id, 'id');
      const scenario = await getResolutionScenarioById(businessId, scenarioId);
      if (!scenario) {
        throw new HttpError(404, 'SCENARIO_NOT_FOUND', 'Scenario not found.');
      }
      res.json({ scenario });
    }),
  );

  router.post(
    '/scenarios/:scenarioId/run',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const scenarioId = parseUuidParam(req.params.scenarioId, 'scenarioId');
      const scenario = await getResolutionScenarioById(businessId, scenarioId);
      if (!scenario) {
        throw new HttpError(404, 'SCENARIO_NOT_FOUND', 'Scenario not found.');
      }
      const forecast = await runForecast(businessId, {
        asOfDate: scenario.asOfDate,
        horizonDays: scenario.horizonDays,
        scenarioId: scenario.id,
        scenarioActions: scenario.actions,
      });
      res.json({ scenario, forecast });
    }),
  );

  return router;
}
