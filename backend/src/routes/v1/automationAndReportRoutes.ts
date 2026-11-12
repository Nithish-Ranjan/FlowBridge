import { Router } from 'express';
import {
  approveQueueItem,
  listAutomationQueue,
  listAutomationRules,
  rejectQueueItem,
} from '../../services/automationService.js';
import {
  listCommunicationLogs,
  sendInvoiceNotification,
  sendPaymentReceiptNotification,
} from '../../services/communicationService.js';
import { generateDailyFinancialPlan } from '../../services/reportService.js';
import { asyncHandler, HttpError, resolveBusinessId } from './helpers.js';

export const automationAndReportRouter: Router = Router();

// Communications
automationAndReportRouter.get(
  '/communications/logs',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const logs = await listCommunicationLogs(businessId);
    res.json(logs);
  }),
);

automationAndReportRouter.post(
  '/communications/send-invoice',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { invoiceId, channel } = req.body ?? {};
    if (!invoiceId) throw new HttpError(400, 'VALIDATION_ERROR', 'invoiceId is required');
    const log = await sendInvoiceNotification({
      businessId,
      invoiceId,
      channel: channel || 'EMAIL',
    });
    res.json(log);
  }),
);

automationAndReportRouter.post(
  '/communications/send-receipt',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const { paymentId, channel } = req.body ?? {};
    if (!paymentId) throw new HttpError(400, 'VALIDATION_ERROR', 'paymentId is required');
    const log = await sendPaymentReceiptNotification({
      businessId,
      paymentId,
      channel: channel || 'WHATSAPP',
    });
    res.json(log);
  }),
);

// Reports
automationAndReportRouter.get(
  '/reports/daily-plan',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const plan = await generateDailyFinancialPlan(businessId);
    res.json(plan);
  }),
);

// Automation
automationAndReportRouter.get(
  '/automation/rules',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const rules = await listAutomationRules(businessId);
    res.json(rules);
  }),
);

automationAndReportRouter.get(
  '/automation/queue',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const queue = await listAutomationQueue(businessId);
    res.json(queue);
  }),
);

automationAndReportRouter.post(
  '/automation/queue/:id/approve',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const actor = req.user?.fullName ?? 'Owner / Approved Desk';
    await approveQueueItem({
      queueId: String(req.params.id),
      businessId,
      approvedBy: actor,
      notes: req.body?.notes,
    });
    res.json({ ok: true });
  }),
);

automationAndReportRouter.post(
  '/automation/queue/:id/reject',
  asyncHandler(async (req, res) => {
    const businessId = await resolveBusinessId(req);
    const actor = req.user?.fullName ?? 'Owner / Approved Desk';
    await rejectQueueItem({
      queueId: String(req.params.id),
      businessId,
      rejectedBy: actor,
      notes: req.body?.notes,
    });
    res.json({ ok: true });
  }),
);
