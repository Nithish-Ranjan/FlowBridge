import { Router } from 'express';
import { checkDatabaseHealth } from '../../db/pool.js';
import { optionalAuth } from '../../middleware/auth.js';
import { authRouter } from './authRoutes.js';
import { automationAndReportRouter } from './automationAndReportRoutes.js';
import { createBusinessRouter } from './businessRoutes.js';
import { createCommitmentRouter } from './commitmentRoutes.js';
import { creditRouter } from './creditAndNegotiationRoutes.js';
import { createForecastResolutionRouter } from './forecastResolutionRoutes.js';
import { asyncHandler } from './helpers.js';
import { createLedgerRouter } from './ledgerRoutes.js';
import { createPaymentRouter } from './paymentRoutes.js';
import { reserveRouter } from './reserveRoutes.js';
import { createRetailerRouter } from './retailerRoutes.js';

export function createV1Router(): Router {
  const router = Router();

  // Attach user/session if present on all v1 endpoints
  router.use(optionalAuth);

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const db = await checkDatabaseHealth();
      res.json({
        ok: db.ok,
        database: db.databaseName,
        version: db.serverVersion,
      });
    }),
  );

  router.use('/auth', authRouter);
  router.use('/reserve', reserveRouter);
  router.use(creditRouter);
  router.use(automationAndReportRouter);
  router.use(createBusinessRouter());
  router.use(createRetailerRouter());
  router.use(createLedgerRouter());
  router.use(createPaymentRouter());
  router.use(createForecastResolutionRouter());
  router.use(createCommitmentRouter());

  return router;
}

