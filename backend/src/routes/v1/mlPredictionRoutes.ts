
import { Router } from 'express';
import { z } from 'zod';

import { listCustomerInvoices } from '../../db/repositories/ledgerRepo.js';
import {
  listPaymentAllocations,
  listPaymentTransactions,
} from '../../db/repositories/paymentRepo.js';
import { getRetailerById } from '../../db/repositories/retailerRepo.js';

import {
  IsoDateSchema,
  UuidSchema,
} from '../../validation/schemas.js';

import {
  asyncHandler,
  HttpError,
  resolveBusinessId,
} from './helpers.js';


const PredictPaymentDelaySchema = z.object({
  retailerId: UuidSchema,
  invoiceAmountPaise: z.string().regex(/^[1-9]\d*$/),
  invoiceDate: IsoDateSchema,
  dueDate: IsoDateSchema,
});


function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);

  return Math.round((toMs - fromMs) / 86_400_000);
}


function monthsBetween(startDateTime: string, endDate: string): number {
  const start = new Date(startDateTime);

  if (Number.isNaN(start.getTime())) {
    return 0;
  }

  const [year, month, day] = endDate.split('-').map(Number);

  let months =
    (year - start.getUTCFullYear()) * 12 +
    (month - 1 - start.getUTCMonth());

  if (day < start.getUTCDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}


function datePart(value: string): string {
  return value.slice(0, 10);
}


export function createMlPredictionRouter(): Router {
  const router = Router();

  router.post(
    '/ml/payment-delay/predict',
    asyncHandler(async (req, res) => {

      // 1. Resolve the authenticated business and validate request.
      const businessId = await resolveBusinessId(req);
      const body = PredictPaymentDelaySchema.parse(req.body);

      if (body.dueDate < body.invoiceDate) {
        throw new HttpError(
          400,
          'INVALID_INVOICE_DATES',
          'Due date cannot be earlier than invoice date.'
        );
      }

      const invoiceAmountPaise = BigInt(body.invoiceAmountPaise);

      // 2. Confirm that the retailer belongs to this business.
      const retailer = await getRetailerById(
        businessId,
        body.retailerId
      );

      if (!retailer) {
        throw new HttpError(
          404,
          'RETAILER_NOT_FOUND',
          'Retailer not found in this business.'
        );
      }

      // 3. Retrieve existing invoice, payment and allocation records.
      const [
        businessInvoices,
        retailerPayments,
        allAllocations,
      ] = await Promise.all([
        listCustomerInvoices(businessId),

        listPaymentTransactions(businessId, {
          retailerId: body.retailerId,
          direction: 'INFLOW',
          matchStatus: 'MATCHED',
        }),

        listPaymentAllocations(businessId),
      ]);

      // Only invoices issued before this prediction invoice
      // can contribute to customer history.
      const priorInvoices = businessInvoices.filter(
        (invoice) =>
          invoice.retailerId === body.retailerId &&
          invoice.invoiceDate < body.invoiceDate &&
          invoice.status !== 'CANCELLED' &&
          invoice.status !== 'WRITTEN_OFF'
      );

      const priorInvoiceIds = new Set(
        priorInvoices.map((invoice) => invoice.id)
      );

      // 4. Select verified, matched, non-reversed incoming payments.
      // The created/updated timestamps and value date must all
      // precede the prediction invoice date.
      const validPayments = retailerPayments.filter(
        (payment) =>
          payment.direction === 'INFLOW' &&
          payment.matchStatus === 'MATCHED' &&
          payment.verificationStatus === 'VERIFIED' &&
          !payment.isReversed &&
          payment.reversalOfTransactionId === null &&
          payment.valueDate < body.invoiceDate &&
          datePart(payment.createdAt) < body.invoiceDate &&
          datePart(payment.updatedAt) < body.invoiceDate
      );

      const validPaymentMap = new Map(
        validPayments.map((payment) => [payment.id, payment])
      );

      // 5. Net allocations for each previous invoice and transaction.
      // REVERSAL allocation rows have negative amounts and are
      // included in the net calculation.
      const netAllocations = new Map<
        string,
        Map<string, bigint>
      >();

      for (const allocation of allAllocations) {
        if (!priorInvoiceIds.has(allocation.invoiceId)) {
          continue;
        }

        if (datePart(allocation.createdAt) >= body.invoiceDate) {
          continue;
        }

        if (!validPaymentMap.has(allocation.paymentTransactionId)) {
          continue;
        }

        if (!netAllocations.has(allocation.invoiceId)) {
          netAllocations.set(allocation.invoiceId, new Map());
        }

        const byPayment = netAllocations.get(allocation.invoiceId)!;

        const previousAmount =
          byPayment.get(allocation.paymentTransactionId) ?? 0n;

       
byPayment.set(
  allocation.paymentTransactionId,
  previousAmount + BigInt(allocation.allocatedAmountPaise)
);

      }

      // 6. Reconstruct customer history.
      const paidDelays: number[] = [];

      let outstandingInvoiceCount = 0;
      let outstandingInvoiceAmountPaise = 0n;

      for (const invoice of priorInvoices) {
        const byPayment = netAllocations.get(invoice.id);

        const paymentEvents = byPayment
          ? Array.from(byPayment.entries())
              .filter(([, amount]) => amount > 0n)
              .map(([paymentId, amount]) => ({
                amount,
                payment: validPaymentMap.get(paymentId)!,
              }))
              .sort((a, b) =>
                a.payment.valueDate.localeCompare(b.payment.valueDate)
              )
          : [];

        const invoiceTotal = BigInt(invoice.totalAmountPaise);

        let paidAsOfDate = 0n;

        for (const event of paymentEvents) {
          paidAsOfDate += event.amount;
        }

        if (paidAsOfDate > invoiceTotal) {
          paidAsOfDate = invoiceTotal;
        }

        // Determine when the invoice first became fully paid
        // using verified net allocations.
        let cumulativePaid = 0n;
        let completionDate: string | null = null;

        for (const event of paymentEvents) {
          cumulativePaid += event.amount;

          if (cumulativePaid >= invoiceTotal) {
            completionDate = event.payment.valueDate;
            break;
          }
        }

        if (completionDate !== null) {
          paidDelays.push(
            daysBetween(invoice.dueDate, completionDate)
          );
        }

        // Outstanding balance reconstructed as of prediction date.
        const outstanding = invoiceTotal - paidAsOfDate;

        if (outstanding > 0n) {
          outstandingInvoiceCount += 1;
          outstandingInvoiceAmountPaise += outstanding;
        }
      }

      const priorPaidCount = paidDelays.length;

      const latePaymentRate =
        priorPaidCount > 0
          ? paidDelays.filter((delay) => delay > 0).length /
            priorPaidCount
          : null;

      const onTimeEarlyRate =
        priorPaidCount > 0
          ? paidDelays.filter((delay) => delay <= 0).length /
            priorPaidCount
          : null;

      const averageDelay =
        priorPaidCount > 0
          ? paidDelays.reduce((sum, delay) => sum + delay, 0) /
            priorPaidCount
          : null;

      // 7. Convert invoice and retailer information into ML features.
      const invoiceAmountInr = Number(invoiceAmountPaise) / 100;

      const outstandingAmountInr =
        Number(outstandingInvoiceAmountPaise) / 100;

      if (
        !Number.isFinite(invoiceAmountInr) ||
        !Number.isFinite(outstandingAmountInr)
      ) {
        throw new HttpError(
          400,
          'INVALID_AMOUNT',
          'Invoice amount is outside the supported numeric range.'
        );
      }

      const paymentTermsDays = daysBetween(
        body.invoiceDate,
        body.dueDate
      );

      const customerRelationshipMonths = monthsBetween(
        retailer.createdAt,
        body.invoiceDate
      );

      // business_sector and customer_segment are omitted.
      // FastAPI supplies UNKNOWN for both.
      const mlRequest = {
        invoice_amount_inr: invoiceAmountInr,
        payment_terms_days: paymentTermsDays,
        customer_relationship_months: customerRelationshipMonths,

        prior_paid_invoice_count: priorPaidCount,
        prior_late_payment_rate: latePaymentRate,
        prior_avg_payment_delay_days: averageDelay,
        prior_on_time_or_early_rate: onTimeEarlyRate,

        prior_outstanding_invoice_count: outstandingInvoiceCount,
        prior_outstanding_invoice_amount_inr: outstandingAmountInr,

        invoice_issue_month: Number(body.invoiceDate.slice(5, 7)),
      };

      // 8. Call the local FastAPI prediction service.
      const mlBaseUrl = (
        process.env.FLOWBRIDGE_ML_API_URL ??
        'http://127.0.0.1:8001'
      ).replace(/\/+$/, '');

      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        10_000
      );

      let mlResponse: Response;

      try {
        mlResponse = await fetch(
          `${mlBaseUrl}/predict`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(mlRequest),
            signal: controller.signal,
          }
        );
      } catch {
        throw new HttpError(
          503,
          'ML_SERVICE_UNAVAILABLE',
          'FlowBridge ML prediction service is unavailable.'
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!mlResponse.ok) {
        if (mlResponse.status === 503) {
          const errBody = await mlResponse.json().catch(() => ({})) as { detail?: string };
          throw new HttpError(
            503,
            'MODEL_NOT_MOUNTED',
            errBody.detail ?? 'Trained XGBoost model artefact is not mounted at backend/ml/models/xgboost_payment_delay.json.'
          );
        }
        throw new HttpError(
          502,
          'ML_PREDICTION_FAILED',
          'FlowBridge ML service could not complete the prediction.'
        );
      }

      const mlResult = await mlResponse.json() as {
        prediction?: {
          payment_delay_days: number;
          interpretation: string;
          unit: string;
        };
        model?: {
          type: string;
          status: string;
          data_type: string;
        };
        disclaimer?: string;
      };

      if (
        typeof mlResult.prediction?.payment_delay_days !== 'number' ||
        !Number.isFinite(mlResult.prediction.payment_delay_days)
      ) {
        throw new HttpError(
          502,
          'INVALID_ML_RESPONSE',
          'ML service returned an invalid prediction.'
        );
      }

      // 9. Return prediction. No invoice or payment records
      // are inserted or modified by this endpoint.
      res.json({
        retailer: {
          id: retailer.id,
          retailerCode: retailer.retailerCode,
          name: retailer.name,
        },

        invoice: {
          invoiceDate: body.invoiceDate,
          dueDate: body.dueDate,
          invoiceAmountPaise: body.invoiceAmountPaise,
        },

        prediction: mlResult.prediction,
        model: mlResult.model,
        disclaimer: mlResult.disclaimer,

        historySummary: {
          priorPaidInvoiceCount: priorPaidCount,
          priorLatePaymentRate: latePaymentRate,
          priorAveragePaymentDelayDays: averageDelay,
          priorOnTimeOrEarlyRate: onTimeEarlyRate,
          priorOutstandingInvoiceCount: outstandingInvoiceCount,
          priorOutstandingInvoiceAmountInr: outstandingAmountInr,
        },
      });
    })
  );

  return router;
}
