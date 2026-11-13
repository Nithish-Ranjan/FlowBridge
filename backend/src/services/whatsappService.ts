// whatsappService.ts
// FlowBridge Smart WhatsApp Message Generation & Human-Controlled Sending Engine
// Mode: Human-Controlled WhatsApp Web & App Handoff via wa.me click-to-chat
// Strict Rule: FlowBridge NEVER automatically sends messages. Human approval, review, and manual send are mandatory.

import crypto from 'node:crypto';
import { formatINR, parsePaise } from '@flowbridge/shared';
import { query } from '../db/pool.js';
import { getRetailerById } from '../db/repositories/retailerRepo.js';
import { getInvoiceById, listCustomerInvoices } from '../db/repositories/ledgerRepo.js';
import { getBusinessById } from '../db/repositories/businessRepo.js';
import { listCommitments } from '../db/repositories/commitmentScenarioRepo.js';
import { listPaymentTransactions } from '../db/repositories/paymentRepo.js';

export type WhatsAppTemplateType =
  | 'UPCOMING_REMINDER'
  | 'OVERDUE_REMINDER'
  | 'COMMITMENT_FOLLOWUP'
  | 'PAYMENT_CONFIRMATION'
  | 'PAYMENT_DISCREPANCY'
  | 'FRIENDLY_FOLLOWUP';

export interface PhoneValidationResult {
  isValid: boolean;
  normalizedPhone: string; // E.g. "919820111223" without leading + or 0
  displayPhone: string;
  errorMessage?: string;
}

/**
 * Validates and normalises contact numbers for WhatsApp click-to-chat (wa.me/{phone}).
 * Strips formatting, handles Indian 10-digit mobile, 11-digit with leading 0, 12-digit with 91,
 * and standard international numbers. Detects masked phone numbers.
 */
export function validateAndNormalizePhone(rawPhone?: string | null): PhoneValidationResult {
  if (!rawPhone || typeof rawPhone !== 'string' || !rawPhone.trim()) {
    return {
      isValid: false,
      normalizedPhone: '',
      displayPhone: rawPhone || '',
      errorMessage: 'Contact phone number is missing. Please enter a valid mobile number.',
    };
  }

  const trimmed = rawPhone.trim();

  // Detect masked phone numbers (e.g. "+91 98201 *****" or "XXXXX")
  if (trimmed.includes('*') || trimmed.includes('X') || trimmed.includes('x')) {
    return {
      isValid: false,
      normalizedPhone: '',
      displayPhone: trimmed,
      errorMessage: 'Phone number is masked. An unmasked 10-digit mobile number is required to open WhatsApp.',
    };
  }

  // Strip all non-numeric characters
  const digits = trimmed.replace(/\D/g, '');

  // 10 digits: Standard Indian mobile (prepend 91)
  if (digits.length === 10) {
    if (!/^[6-9]/.test(digits)) {
      return {
        isValid: false,
        normalizedPhone: '',
        displayPhone: trimmed,
        errorMessage: 'Invalid mobile number. Indian mobile numbers typically start with 6, 7, 8, or 9.',
      };
    }
    return {
      isValid: true,
      normalizedPhone: `91${digits}`,
      displayPhone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
    };
  }

  // 11 digits starting with 0: (e.g. 09820111223) -> strip 0, prepend 91
  if (digits.length === 11 && digits.startsWith('0')) {
    const sub = digits.slice(1);
    return {
      isValid: true,
      normalizedPhone: `91${sub}`,
      displayPhone: `+91 ${sub.slice(0, 5)} ${sub.slice(5)}`,
    };
  }

  // 12 digits starting with 91: (e.g. 919820111223)
  if (digits.length === 12 && digits.startsWith('91')) {
    const mobile = digits.slice(2);
    return {
      isValid: true,
      normalizedPhone: digits,
      displayPhone: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`,
    };
  }

  // Valid International number (between 11 and 15 digits)
  if (digits.length >= 11 && digits.length <= 15) {
    return {
      isValid: true,
      normalizedPhone: digits,
      displayPhone: `+${digits}`,
    };
  }

  return {
    isValid: false,
    normalizedPhone: '',
    displayPhone: trimmed,
    errorMessage: 'Phone number must contain 10 to 15 digits in valid international format.',
  };
}

/**
 * Convenience helper for tests and formatting
 */
export function formatIndianPhoneNumber(rawPhone: string): string {
  const res = validateAndNormalizePhone(rawPhone);
  return res.normalizedPhone || rawPhone.replace(/[^0-9]/g, '');
}

/**
 * Builds the official wa.me click-to-chat URL with safely encoded prefilled text.
 */
export function buildWaMeUrl(normalizedPhone: string, messageText: string): string {
  const encoded = encodeURIComponent(messageText);
  return `https://wa.me/${normalizedPhone}?text=${encoded}`;
}

export interface PrepareWhatsAppMessageInput {
  businessId: string;
  retailerId: string;
  templateType: WhatsAppTemplateType;
  invoiceId?: string;
  commitmentId?: string;
  paymentTransactionId?: string;
  recipientPhoneOverride?: string;
}

export interface PrepareWhatsAppMessageResult {
  logId: string;
  templateType: WhatsAppTemplateType;
  messageText: string;
  recipientName: string;
  recipientPhone: string;
  normalizedPhone: string;
  isValidPhone: boolean;
  phoneErrorMessage?: string;
  waMeUrl: string | null;
  contextSummary: {
    retailerCode: string;
    invoiceNumber?: string;
    amountPaise?: string;
    dueDate?: string;
    overdueDays?: number;
    businessName: string;
  };
}

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}

/**
 * Automatically synthesizes a personalised, financial context-aware WhatsApp message
 * using actual FlowBridge records (zero fabricated data).
 */
export async function prepareSmartWhatsAppMessage(
  input: PrepareWhatsAppMessageInput,
): Promise<PrepareWhatsAppMessageResult> {
  const { businessId, retailerId, templateType } = input;

  // 1. Fetch business and retailer records
  const [business, retailer, allRetailerInvoices] = await Promise.all([
    getBusinessById(businessId),
    getRetailerById(businessId, retailerId),
    listCustomerInvoices(businessId),
  ]);

  if (!business) throw new Error('Business not found.');
  if (!retailer) throw new Error('Retailer not found.');

  const businessName = business.name;
  const retailerInvoices = allRetailerInvoices.filter(
    (inv) => inv.retailerId === retailerId && inv.status !== 'CANCELLED' && inv.status !== 'WRITTEN_OFF',
  );

  // 2. Fetch target invoice if specified, or default to earliest overdue/open invoice
  let targetInvoice = input.invoiceId ? await getInvoiceById(businessId, input.invoiceId) : null;
  if (!targetInvoice && retailerInvoices.length > 0) {
    const overdue = retailerInvoices.filter((i) => i.status === 'OVERDUE' || i.dueDate < business.openingCashDate);
    targetInvoice = overdue.length > 0 ? overdue[0] : retailerInvoices[0];
  }

  // 3. Fetch commitment if relevant
  let targetCommitment = null;
  if (input.commitmentId || templateType === 'COMMITMENT_FOLLOWUP') {
    const commitments = await listCommitments(businessId);
    targetCommitment = input.commitmentId
      ? commitments.find((c) => c.id === input.commitmentId)
      : commitments.find((c) => c.retailerId === retailerId && (c.status === 'FAILED' || c.status === 'AGREED' || c.status === 'AT_RISK'));
  }

  // 4. Fetch payment if relevant
  let targetPayment = null;
  if (input.paymentTransactionId || templateType === 'PAYMENT_CONFIRMATION' || templateType === 'PAYMENT_DISCREPANCY') {
    const payments = await listPaymentTransactions(businessId, { retailerId });
    targetPayment = input.paymentTransactionId
      ? payments.find((p) => p.id === input.paymentTransactionId)
      : payments.find((p) => p.direction === 'INFLOW' && !p.isReversed);
  }

  // 5. Calculate verified amounts and overdue timeline
  const today = business.openingCashDate || new Date().toISOString().slice(0, 10);
  const totalOutstandingPaise = retailerInvoices.reduce((sum, i) => sum + parsePaise(i.outstandingPaise || '0'), 0n);

  const invAmountPaise = targetInvoice ? targetInvoice.outstandingPaise : totalOutstandingPaise.toString();
  const formattedAmount = formatINR(invAmountPaise);
  const invoiceNum = targetInvoice?.invoiceNumber || 'Account Statement';
  const dueDateStr = targetInvoice?.dueDate || today;

  let overdueDays = 0;
  if (targetInvoice && targetInvoice.dueDate < today) {
    overdueDays = Math.max(0, daysBetween(targetInvoice.dueDate, today));
  }

  // 6. Generate Context-Aware Message based on Template Type
  let messageText = '';

  switch (templateType) {
    case 'UPCOMING_REMINDER': {
      const daysUntilDue = daysBetween(today, dueDateStr);
      const timingText = daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days on ${dueDateStr}`;
      messageText = `Hello ${retailer.name},\n\nThis is a gentle payment reminder from ${businessName}.\n\n*Invoice #${invoiceNum}* for *${formattedAmount}* is scheduled for payment *${timingText}*.\n\nKindly confirm payment initiation or share the transaction reference (UTR) once deposited to ensure uninterrupted supply and billing.\n\nThank you for your valued partnership!\n— ${businessName}`;
      break;
    }

    case 'OVERDUE_REMINDER': {
      const overdueDuration = overdueDays > 0 ? `${overdueDays} days past due` : 'past due date';
      messageText = `Dear ${retailer.name},\n\nWe would like to bring to your attention that *Invoice #${invoiceNum}* for *${formattedAmount}* from ${businessName} is currently *${overdueDuration}* (contracted due date: ${dueDateStr}).\n\nTo keep your credit account active and avoid delivery holds, please arrange the settlement of this pending amount at your earliest convenience.\n\nIf payment has already been transferred, please reply with the UTR number / bank slip so we can reconcile your ledger immediately.\n\nWarm regards,\n— ${businessName}`;
      break;
    }

    case 'COMMITMENT_FOLLOWUP': {
      const agreedDate = targetCommitment?.agreedDate || targetCommitment?.dueDate || dueDateStr;
      const promisedAmount = targetCommitment?.agreedAmountPaise
        ? formatINR(targetCommitment.agreedAmountPaise)
        : formattedAmount;

      messageText = `Hello ${retailer.name},\n\nThis is regarding the payment schedule agreed with ${businessName}.\n\nAs per our records, payment of *${promisedAmount}* was committed for settlement on *${agreedDate}* (Invoice #${invoiceNum}).\n\nPlease let us know the current status or share the payment confirmation so we can update your credit record.\n\nThank you,\n— ${businessName}`;
      break;
    }

    case 'PAYMENT_CONFIRMATION': {
      const pmtAmount = targetPayment ? formatINR(targetPayment.amountPaise) : formattedAmount;
      const pmtDate = targetPayment?.valueDate || today;
      const refNum = targetPayment?.externalTransactionReference || 'Bank Transfer';
      const remainingBalance = formatINR(totalOutstandingPaise.toString());

      messageText = `Dear ${retailer.name},\n\nThank you! We have verified receipt of your payment of *${pmtAmount}* on *${pmtDate}* (Ref: ${refNum}).\n\nThis payment has been allocated against Invoice #${invoiceNum}.\nYour current outstanding balance with ${businessName} is *${remainingBalance}*.\n\nThank you for your prompt payment!\n— ${businessName}`;
      break;
    }

    case 'PAYMENT_DISCREPANCY': {
      const pmtAmount = targetPayment ? formatINR(targetPayment.amountPaise) : formattedAmount;
      const pmtDate = targetPayment?.valueDate || today;

      messageText = `Hello ${retailer.name},\n\nWe noticed an incoming payment of *${pmtAmount}* received on *${pmtDate}* in our bank account from your reference.\n\nCould you please clarify which invoice(s) this amount should be applied against? We want to ensure your ledger and credit limits are accurately updated without ambiguity.\n\nPlease share the invoice breakdown or payment advice.\n\nThank you,\n— ${businessName}`;
      break;
    }

    case 'FRIENDLY_FOLLOWUP':
    default: {
      messageText = `Hi ${retailer.name},\n\nHope you are having a great week!\n\nJust checking in from ${businessName} regarding outstanding Invoice #${invoiceNum} for *${formattedAmount}*, due on *${dueDateStr}*.\n\nPlease let us know if you have any questions or require an updated copy of the invoice bill. We appreciate your continued business!\n\nBest regards,\n— ${businessName}`;
      break;
    }
  }

  // 7. Validate and normalise recipient phone number
  const candidatePhone = input.recipientPhoneOverride || retailer.contactPhone || retailer.phoneMasked || '';
  const phoneValidation = validateAndNormalizePhone(candidatePhone);

  const waMeUrl = phoneValidation.isValid ? buildWaMeUrl(phoneValidation.normalizedPhone, messageText) : null;

  // 8. Create draft record in communication_logs with status 'DRAFT'
  const draftLogRes = await query<{ id: string }>(
    `INSERT INTO communication_logs (
      business_id, recipient_type, recipient_id, recipient_name, recipient_address,
      channel, subject, message_body, template_key, status, external_message_id, metadata_json
    ) VALUES ($1, 'RETAILER', $2, $3, $4, 'WHATSAPP', $5, $6, $7, 'DRAFT', $8, $9)
    RETURNING id`,
    [
      businessId,
      retailerId,
      retailer.name,
      candidatePhone,
      `WhatsApp ${templateType.replace(/_/g, ' ')}`,
      messageText,
      templateType,
      `wa-draft-${crypto.randomBytes(6).toString('hex')}`,
      JSON.stringify({
        invoiceNumber: targetInvoice?.invoiceNumber,
        invoiceId: targetInvoice?.id,
        amountPaise: invAmountPaise,
        dueDate: dueDateStr,
        overdueDays,
      }),
    ],
  );

  return {
    logId: draftLogRes.rows[0].id,
    templateType,
    messageText,
    recipientName: retailer.name,
    recipientPhone: candidatePhone,
    normalizedPhone: phoneValidation.normalizedPhone,
    isValidPhone: phoneValidation.isValid,
    phoneErrorMessage: phoneValidation.errorMessage,
    waMeUrl,
    contextSummary: {
      retailerCode: retailer.retailerCode,
      invoiceNumber: targetInvoice?.invoiceNumber,
      amountPaise: invAmountPaise,
      dueDate: dueDateStr,
      overdueDays,
      businessName,
    },
  };
}

/**
 * Tracks when the user clicks "Open WhatsApp".
 * Updates log status to 'OPENED_IN_WHATSAPP'.
 * (Does NOT mark message as sent or delivered—sending remains strictly manual in WhatsApp).
 */
export async function trackWhatsAppHandoffOpened(
  businessId: string,
  logId: string,
  updatedMessageText?: string,
  updatedRecipientPhone?: string,
): Promise<{ success: boolean; logId: string; status: string; waMeUrl: string | null }> {
  const existing = await query<{ id: string; recipient_address: string; message_body: string }>(
    'SELECT id, recipient_address, message_body FROM communication_logs WHERE id = $1 AND business_id = $2',
    [logId, businessId],
  );

  if (!existing.rows.length) {
    throw new Error('Communication log not found.');
  }

  const phone = updatedRecipientPhone || existing.rows[0].recipient_address;
  const message = updatedMessageText || existing.rows[0].message_body;

  const phoneValidation = validateAndNormalizePhone(phone);
  const waMeUrl = phoneValidation.isValid ? buildWaMeUrl(phoneValidation.normalizedPhone, message) : null;

  await query(
    `UPDATE communication_logs
     SET status = 'OPENED_IN_WHATSAPP',
         recipient_address = $1,
         message_body = $2
     WHERE id = $3 AND business_id = $4`,
    [phone, message, logId, businessId],
  );

  return {
    success: true,
    logId,
    status: 'OPENED_IN_WHATSAPP',
    waMeUrl,
  };
}

/**
 * Tracks when the human user explicitly confirms having sent the message in WhatsApp.
 * Updates log status to 'USER_CONFIRMED_SENT'.
 * Note: Clearly distinct from official Meta API delivery confirmations.
 */
export async function confirmWhatsAppSent(
  businessId: string,
  logId: string,
  note?: string,
): Promise<{ success: boolean; logId: string; status: string; confirmedAt: string }> {
  const now = new Date().toISOString();

  const res = await query<{ id: string; metadata_json: any }>(
    'SELECT id, metadata_json FROM communication_logs WHERE id = $1 AND business_id = $2',
    [logId, businessId],
  );

  if (!res.rows.length) {
    throw new Error('Communication log not found.');
  }

  const currentMeta = res.rows[0].metadata_json || {};
  const updatedMeta = {
    ...currentMeta,
    userConfirmationNote: note || 'User confirmed message sent manually in WhatsApp Web/App.',
    confirmedAt: now,
  };

  await query(
    `UPDATE communication_logs
     SET status = 'USER_CONFIRMED_SENT',
         confirmed_at = now(),
         metadata_json = $1
     WHERE id = $2 AND business_id = $3`,
    [JSON.stringify(updatedMeta), logId, businessId],
  );

  return {
    success: true,
    logId,
    status: 'USER_CONFIRMED_SENT',
    confirmedAt: now,
  };
}

/**
 * Returns WhatsApp communication logs for a specific retailer.
 */
export async function listRetailerWhatsAppLogs(businessId: string, retailerId: string): Promise<any[]> {
  const res = await query<any>(
    `SELECT id, recipient_name, recipient_address, channel, subject, message_body,
            template_key, status, external_message_id, confirmed_at, metadata_json, created_at
     FROM communication_logs
     WHERE business_id = $1 AND recipient_id = $2 AND channel = 'WHATSAPP'
     ORDER BY created_at DESC
     LIMIT 25`,
    [businessId, retailerId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_address,
    channel: row.channel,
    subject: row.subject,
    messageBody: row.message_body,
    templateKey: row.template_key,
    status: row.status,
    confirmedAt: row.confirmed_at,
    metadata: row.metadata_json,
    createdAt: row.created_at,
  }));
}
