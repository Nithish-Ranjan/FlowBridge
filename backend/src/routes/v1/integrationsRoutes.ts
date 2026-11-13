import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { parseIndianBankSms } from '../../services/bankSmsParser.js';
import { sendEmail, testSmtpConnection } from '../../services/emailService.js';
import {
  prepareSmartWhatsAppMessage,
  trackWhatsAppHandoffOpened,
  confirmWhatsAppSent,
  listRetailerWhatsAppLogs,
  validateAndNormalizePhone,
  buildWaMeUrl,
  type WhatsAppTemplateType,
} from '../../services/whatsappService.js';
import { asyncHandler } from './helpers.js';
import { hashPassword } from '../../utils/passwords.js';

export const integrationsRouter: Router = Router();

// ── 1. BUSINESS PROFILE & ONBOARDING ────────────────────────────

integrationsRouter.get(
  '/business/:businessId/profile',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const q = await query(
      `SELECT id, code, name, owner_name, contact_phone, whatsapp_phone, business_type, warehouse_address,
              email_configurations, whatsapp_configurations, connected_devices, opening_cash_paise, opening_cash_date
       FROM businesses WHERE id = $1`,
      [businessId],
    );

    if (!q.rows.length) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    res.json({ profile: q.rows[0] });
  }),
);

integrationsRouter.patch(
  '/business/:businessId/profile',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const {
      ownerName,
      contactPhone,
      whatsappPhone,
      businessType,
      warehouseAddress,
      emailConfigurations,
      whatsappConfigurations,
    } = req.body;

    const q = await query(
      `UPDATE businesses
       SET owner_name = COALESCE($1, owner_name),
           contact_phone = COALESCE($2, contact_phone),
           whatsapp_phone = COALESCE($3, whatsapp_phone),
           business_type = COALESCE($4, business_type),
           warehouse_address = COALESCE($5, warehouse_address),
           email_configurations = COALESCE($6, email_configurations),
           whatsapp_configurations = COALESCE($7, whatsapp_configurations),
           updated_at = now()
       WHERE id = $8
       RETURNING id, code, name, owner_name, contact_phone, whatsapp_phone, business_type, warehouse_address,
                 email_configurations, whatsapp_configurations`,
      [
        ownerName ?? null,
        contactPhone ?? null,
        whatsappPhone ?? null,
        businessType ?? null,
        warehouseAddress ?? null,
        emailConfigurations ? JSON.stringify(emailConfigurations) : null,
        whatsappConfigurations ? JSON.stringify(whatsappConfigurations) : null,
        businessId,
      ],
    );

    res.json({ profile: q.rows[0] });
  }),
);

integrationsRouter.post(
  '/business/onboard',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      businessName,
      businessCode,
      ownerName,
      contactPhone,
      whatsappPhone,
      warehouseAddress,
      email,
      password,
      openingCashPaise = 0,
    } = req.body;

    if (!businessName || !email || !password) {
      res.status(400).json({ error: 'Business name, email, and password are required' });
      return;
    }

    const code = businessCode || `DIST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const result = await withTransaction(async (client: PoolClient) => {
      const bizRes = await client.query(
        `INSERT INTO businesses (
          code, name, owner_name, contact_phone, whatsapp_phone, warehouse_address,
          currency, timezone, opening_cash_paise, opening_cash_date, minimum_cash_paise
        ) VALUES ($1, $2, $3, $4, $5, $6, 'INR', 'Asia/Kolkata', $7, now()::date, 0)
        RETURNING id, code, name`,
        [code, businessName, ownerName || null, contactPhone || null, whatsappPhone || null, warehouseAddress || null, openingCashPaise],
      );
      const biz = bizRes.rows[0];

      const pwHash = hashPassword(password);
      const userRes = await client.query(
        `INSERT INTO users (
          business_id, email, password_hash, full_name, role
        ) VALUES ($1, $2, $3, $4, 'OWNER')
        RETURNING id, email, full_name, role`,
        [biz.id, email.toLowerCase().trim(), pwHash, ownerName || businessName],
      );

      return { business: biz, user: userRes.rows[0] };
    });

    res.json(result);
  }),
);

// ── 2. BANK SMS TRANSACTION INGESTION ───────────────────────────

integrationsRouter.post(
  '/business/:businessId/sms/parse-raw',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const { rawSms, senderHeader } = req.body;

    if (!rawSms) {
      res.status(400).json({ error: 'rawSms is required' });
      return;
    }

    const parsed = parseIndianBankSms(rawSms, senderHeader || '');
    if (!parsed) {
      res.status(422).json({ error: 'Could not extract valid financial transaction from message' });
      return;
    }

    // Match candidate invoices in the database
    const invQuery = await query(
      `SELECT ci.id, ci.invoice_number, ci.total_amount_paise, ci.balance_due_paise, ci.due_date, ci.status,
              r.id as retailer_id, r.name as retailer_name, r.retailer_code
       FROM customer_invoices ci
       JOIN retailers r ON ci.retailer_id = r.id
       WHERE ci.business_id = $1 AND ci.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
       ORDER BY ci.due_date ASC`,
      [businessId],
    );

    const candidates = invQuery.rows.map((inv: any) => {
      let matchScore = 0;
      const reasons: string[] = [];

      // Exact amount match
      if (Math.abs(Number(inv.balance_due_paise) - parsed.amountPaise) === 0) {
        matchScore += 60;
        reasons.push('Exact amount match');
      } else if (Math.abs(Number(inv.total_amount_paise) - parsed.amountPaise) === 0) {
        matchScore += 50;
        reasons.push('Matches original invoice total');
      }

      // Retailer name or code matches counterparty hint
      if (parsed.counterpartyHint) {
        const hint = parsed.counterpartyHint.toLowerCase();
        const rName = inv.retailer_name.toLowerCase();
        if (rName.includes(hint) || hint.includes(rName.split(' ')[0])) {
          matchScore += 35;
          reasons.push(`Counterparty hint '${parsed.counterpartyHint}' matches ${inv.retailer_name}`);
        }
      }

      return {
        invoice: inv,
        matchScore,
        reasons,
      };
    }).filter((c: any) => c.matchScore > 0).sort((a: any, b: any) => b.matchScore - a.matchScore);

    // Save evidence into database
    const savedEvidence = await query(
      `INSERT INTO transaction_sms_evidence (
        business_id, sender_header, raw_sms_body, parsed_amount_paise, parsed_reference_number,
        parsed_counterparty_hint, parsed_transaction_date, parsed_account_tail, confidence_score, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PARSED')
      RETURNING id, sender_header, parsed_amount_paise, parsed_reference_number, parsed_counterparty_hint, parsed_transaction_date, status, confidence_score, created_at`,
      [
        businessId,
        senderHeader || parsed.bank,
        rawSms,
        parsed.amountPaise,
        parsed.referenceNumber,
        parsed.counterpartyHint,
        parsed.transactionDate,
        parsed.accountTail,
        parsed.confidenceScore,
      ],
    );

    res.json({
      parsed,
      candidates,
      evidence: savedEvidence.rows[0],
    });
  }),
);

integrationsRouter.get(
  '/business/:businessId/sms/evidence',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const q = await query(
      `SELECT id, sender_header, raw_sms_body, parsed_amount_paise, parsed_reference_number,
              parsed_counterparty_hint, parsed_transaction_date, parsed_account_tail, status, confidence_score, created_at
       FROM transaction_sms_evidence
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [businessId],
    );

    res.json({ evidence: q.rows });
  }),
);

// ── 3. EMAIL INTEGRATIONS ───────────────────────────────────────

integrationsRouter.post(
  '/integrations/email/test',
  asyncHandler(async (req: Request, res: Response) => {
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass } = req.body;
    const testResult = await testSmtpConnection({
      smtpHost,
      smtpPort: Number(smtpPort) || 587,
      smtpSecure: Boolean(smtpSecure),
      smtpUser,
      smtpPass,
    });

    res.json(testResult);
  }),
);

integrationsRouter.post(
  '/integrations/email/send',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId, recipientEmail, recipientName, subject, htmlBody, pdfFilename, pdfBase64, templateKey } = req.body;
    if (!businessId || !recipientEmail || !subject || !htmlBody) {
      res.status(400).json({ error: 'businessId, recipientEmail, subject, and htmlBody are required' });
      return;
    }

    const result = await sendEmail({
      businessId,
      recipientEmail,
      recipientName,
      subject,
      htmlBody,
      pdfFilename,
      pdfBase64,
      templateKey,
    });

    res.json(result);
  }),
);

integrationsRouter.get(
  '/business/:businessId/email/queue',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const q = await query(
      `SELECT id, recipient_email, recipient_name, subject, pdf_filename, status, sent_at, error_message, created_at
       FROM email_delivery_queue
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [businessId],
    );

    res.json({ queue: q.rows });
  }),
);

// ── 4. WHATSAPP SMART GENERATION & HUMAN-CONTROLLED SENDING ─────────

// Prepare smart WhatsApp message with real FlowBridge financial context
integrationsRouter.post(
  '/integrations/whatsapp/prepare',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId, retailerId, templateType, invoiceId, commitmentId, paymentTransactionId, recipientPhoneOverride } = req.body;
    if (!businessId || !retailerId) {
      res.status(400).json({ error: 'businessId and retailerId are required.' });
      return;
    }

    const result = await prepareSmartWhatsAppMessage({
      businessId,
      retailerId,
      templateType: (templateType as WhatsAppTemplateType) || 'UPCOMING_REMINDER',
      invoiceId,
      commitmentId,
      paymentTransactionId,
      recipientPhoneOverride,
    });

    res.json(result);
  }),
);

// Track user clicking "Open WhatsApp"
integrationsRouter.post(
  '/integrations/whatsapp/open',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId, logId, updatedMessageText, updatedRecipientPhone } = req.body;
    if (!businessId || !logId) {
      res.status(400).json({ error: 'businessId and logId are required.' });
      return;
    }

    const result = await trackWhatsAppHandoffOpened(businessId, logId, updatedMessageText, updatedRecipientPhone);
    res.json(result);
  }),
);

// Human confirmation that message was sent manually in WhatsApp
integrationsRouter.post(
  '/integrations/whatsapp/confirm',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId, logId, note } = req.body;
    if (!businessId || !logId) {
      res.status(400).json({ error: 'businessId and logId are required.' });
      return;
    }

    const result = await confirmWhatsAppSent(businessId, logId, note);
    res.json(result);
  }),
);

// History of WhatsApp communications for this retailer
integrationsRouter.get(
  '/integrations/whatsapp/history/:retailerId',
  asyncHandler(async (req: Request, res: Response) => {
    const retailerId = String(req.params.retailerId || '');
    const businessId = String(req.query.businessId || '');
    if (!businessId || !retailerId) {
      res.status(400).json({ error: 'businessId and retailerId are required.' });
      return;
    }

    const history = await listRetailerWhatsAppLogs(businessId, retailerId);
    res.json({ history });
  }),
);

// Fallback legacy endpoint
integrationsRouter.post(
  '/integrations/whatsapp/send',
  asyncHandler(async (req: Request, res: Response) => {
    const { businessId, recipientPhone, messageText } = req.body;
    if (!businessId || !recipientPhone || !messageText) {
      res.status(400).json({ error: 'businessId, recipientPhone, and messageText are required.' });
      return;
    }

    const validation = validateAndNormalizePhone(recipientPhone);
    const handoffUrl = validation.isValid ? buildWaMeUrl(validation.normalizedPhone, messageText) : undefined;

    res.json({
      mode: 'WEB_HAIL',
      success: validation.isValid,
      handoffUrl,
      error: validation.errorMessage,
    });
  }),
);

// Meta Cloud API Webhook Verification (for Mode B)
integrationsRouter.get('/integrations/whatsapp/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'flowbridge_verify_token')) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Meta Cloud API Webhook Event Handler (delivery receipts, inbound replies)
integrationsRouter.post(
  '/integrations/whatsapp/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    res.sendStatus(200);

    try {
      if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const msg = body.entry[0].changes[0].value.messages[0];
        const from = msg.from;
        const text = msg.text?.body || '';
        console.log(`[WhatsApp Webhook] Inbound message from ${from}: ${text}`);
      }
    } catch (e) {
      console.error('[WhatsApp Webhook Error]', e);
    }
  }),
);
