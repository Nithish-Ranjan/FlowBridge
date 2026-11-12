import { Router } from 'express';
import { z } from 'zod';
import { listCommitments } from '../../db/repositories/commitmentScenarioRepo.js';
import {
  proposeCommitmentsFromActions,
  reconcileCommitmentsWithBankRows,
  recordHumanReplyOnCommitment,
  runVerificationAndRadar,
} from '../../services/engineService.js';
import {
  CommitmentCreateSchema,
  CommitmentStatusUpdateSchema,
  IsoDateSchema,
} from '../../validation/schemas.js';
import { asyncHandler, parseUuidParam, resolveBusinessId } from './helpers.js';

const CommitmentBatchOrSingleSchema = z.union([
  z.object({ actions: z.array(CommitmentCreateSchema).min(1) }),
  CommitmentCreateSchema,
]);

const ReconcileRequestSchema = z.object({
  asOfDate: IsoDateSchema.optional(),
  assumeBankDataComplete: z.boolean().optional(),
});

const RadarPostSchema = z.object({
  asOfDate: IsoDateSchema.optional(),
  horizonDays: z.number().int().min(1).max(180).default(16),
  simulatedDelays: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        delayDays: z.number().int().min(1).max(60),
      }),
    )
    .default([]),
});

export function createCommitmentRouter(): Router {
  const router = Router();

  router.get(
    '/commitments',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const commitments = await listCommitments(businessId);
      res.json({ commitments });
    }),
  );

  router.post(
    '/commitments',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = CommitmentBatchOrSingleSchema.parse(req.body);
      const actions = 'actions' in body ? body.actions : [body];
      const commitments = await proposeCommitmentsFromActions(businessId, actions);
      res.status(201).json({
        commitments,
        commitment: commitments[0],
      });
    }),
  );

  router.patch(
    '/commitments/:id/status',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const commitmentId = parseUuidParam(req.params.id, 'id');
      const body = CommitmentStatusUpdateSchema.parse(req.body);
      const commitment = await recordHumanReplyOnCommitment(businessId, commitmentId, {
        decision: body.status,
        humanReplyBy: body.humanReplyBy,
        humanReplyChannel: body.humanReplyChannel,
        humanReplyNotes: body.humanReplyNotes,
        agreedAmountPaise: body.agreedAmountPaise,
        agreedDate: body.agreedDate,
        fulfilledAmountPaise: body.fulfilledAmountPaise,
      });
      res.json({ commitment });
    }),
  );

  router.get(
    '/risk/promise-failure-radar',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const asOfDate =
        typeof req.query.asOfDate === 'string' && req.query.asOfDate
          ? IsoDateSchema.parse(req.query.asOfDate)
          : undefined;
      const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 16;
      const report = await runVerificationAndRadar(businessId, { asOfDate, horizonDays });
      res.json(report);
    }),
  );

  router.post(
    '/risk/promise-failure-radar',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = RadarPostSchema.parse(req.body ?? {});
      const verification = await runVerificationAndRadar(businessId, {
        asOfDate: body.asOfDate,
        horizonDays: body.horizonDays,
        simulatedDelays: body.simulatedDelays,
      });
      res.json({ verification });
    }),
  );

  router.post(
    '/verification/reconcile',
    asyncHandler(async (req, res) => {
      const businessId = await resolveBusinessId(req);
      const body = ReconcileRequestSchema.parse(req.body ?? {});
      const reconciliation = await reconcileCommitmentsWithBankRows(businessId, body);
      res.json(reconciliation);
    }),
  );

  return router;
}
