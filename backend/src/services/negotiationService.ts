import { paiseToString, parsePaise } from '@flowbridge/shared';
import { getPool, withTransaction } from '../db/pool.js';
import { recordAuditEvent } from '../db/repositories/paymentRepo.js';

export interface NegotiationMessageDTO {
  id: string;
  senderType: 'DISTRIBUTOR' | 'COUNTERPARTY';
  senderName: string;
  messageText: string;
  channel: string;
  createdAt: string;
}

export interface PaymentNegotiationDTO {
  id: string;
  businessId: string;
  customerInvoiceId: string | null;
  supplierBillId: string | null;
  counterpartyType: 'RETAILER' | 'SUPPLIER';
  counterpartyId: string;
  counterpartyName: string;
  originalAmountPaise: string;
  originalDueDate: string;
  proposedAmountPaise: string;
  proposedDueDate: string;
  counterOfferAmountPaise: string | null;
  counterOfferDueDate: string | null;
  status: 'PROPOSED' | 'COUNTER_OFFERED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  channel: string;
  createdAt: string;
  updatedAt: string;
  messages?: NegotiationMessageDTO[];
}

export async function listNegotiations(businessId: string): Promise<PaymentNegotiationDTO[]> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    business_id: string;
    customer_invoice_id: string | null;
    supplier_bill_id: string | null;
    counterparty_type: string;
    counterparty_id: string;
    counterparty_name: string;
    original_amount_paise: string;
    original_due_date: string;
    proposed_amount_paise: string;
    proposed_due_date: string;
    counter_offer_amount_paise: string | null;
    counter_offer_due_date: string | null;
    status: string;
    channel: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT * FROM payment_negotiations WHERE business_id = $1 ORDER BY updated_at DESC`,
    [businessId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    customerInvoiceId: row.customer_invoice_id,
    supplierBillId: row.supplier_bill_id,
    counterpartyType: row.counterparty_type as PaymentNegotiationDTO['counterpartyType'],
    counterpartyId: row.counterparty_id,
    counterpartyName: row.counterparty_name,
    originalAmountPaise: row.original_amount_paise,
    originalDueDate: row.original_due_date,
    proposedAmountPaise: row.proposed_amount_paise,
    proposedDueDate: row.proposed_due_date,
    counterOfferAmountPaise: row.counter_offer_amount_paise,
    counterOfferDueDate: row.counter_offer_due_date,
    status: row.status as PaymentNegotiationDTO['status'],
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createNegotiationProposal(input: {
  businessId: string;
  customerInvoiceId?: string | null;
  supplierBillId?: string | null;
  counterpartyType: 'RETAILER' | 'SUPPLIER';
  counterpartyId: string;
  counterpartyName: string;
  originalAmountPaise: string;
  originalDueDate: string;
  proposedAmountPaise: string;
  proposedDueDate: string;
  channel?: string;
  initialMessage?: string;
}): Promise<PaymentNegotiationDTO> {
  return withTransaction(async (client) => {
    const res = await client.query<any>(
      `INSERT INTO payment_negotiations (
        business_id, customer_invoice_id, supplier_bill_id, counterparty_type,
        counterparty_id, counterparty_name, original_amount_paise, original_due_date,
        proposed_amount_paise, proposed_due_date, status, channel
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PROPOSED', $11)
      RETURNING *`,
      [
        input.businessId,
        input.customerInvoiceId ?? null,
        input.supplierBillId ?? null,
        input.counterpartyType,
        input.counterpartyId,
        input.counterpartyName,
        input.originalAmountPaise,
        input.originalDueDate,
        input.proposedAmountPaise,
        input.proposedDueDate,
        input.channel || 'WHATSAPP',
      ],
    );

    const neg = res.rows[0];

    if (input.initialMessage) {
      await client.query(
        `INSERT INTO negotiation_messages (negotiation_id, sender_type, sender_name, message_text, channel)
         VALUES ($1, 'COUNTERPARTY', $2, $3, $4)`,
        [neg.id, input.counterpartyName, input.initialMessage, input.channel || 'WHATSAPP'],
      );
    }

    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'NEGOTIATION_PROPOSED',
        entityType: 'payment_negotiations',
        entityId: neg.id,
        actor: input.counterpartyName,
        payload: {
          proposedAmountPaise: input.proposedAmountPaise,
          proposedDueDate: input.proposedDueDate,
        },
      },
      client,
    );

    return {
      id: neg.id,
      businessId: neg.business_id,
      customerInvoiceId: neg.customer_invoice_id,
      supplierBillId: neg.supplier_bill_id,
      counterpartyType: neg.counterparty_type,
      counterpartyId: neg.counterparty_id,
      counterpartyName: neg.counterparty_name,
      originalAmountPaise: neg.original_amount_paise,
      originalDueDate: neg.original_due_date,
      proposedAmountPaise: neg.proposed_amount_paise,
      proposedDueDate: neg.proposed_due_date,
      counterOfferAmountPaise: null,
      counterOfferDueDate: null,
      status: 'PROPOSED',
      channel: neg.channel,
      createdAt: neg.created_at,
      updatedAt: neg.updated_at,
    };
  });
}

export async function submitCounterOffer(input: {
  negotiationId: string;
  businessId: string;
  counterOfferAmountPaise: string;
  counterOfferDueDate: string;
  messageText?: string;
  actor: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE payment_negotiations
       SET counter_offer_amount_paise = $1, counter_offer_due_date = $2,
           status = 'COUNTER_OFFERED', updated_at = now()
       WHERE id = $3 AND business_id = $4`,
      [input.counterOfferAmountPaise, input.counterOfferDueDate, input.negotiationId, input.businessId],
    );

    if (input.messageText) {
      await client.query(
        `INSERT INTO negotiation_messages (negotiation_id, sender_type, sender_name, message_text, channel)
         VALUES ($1, 'DISTRIBUTOR', $2, $3, 'WHATSAPP')`,
        [input.negotiationId, input.actor, input.messageText],
      );
    }

    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'NEGOTIATION_COUNTER_OFFERED',
        entityType: 'payment_negotiations',
        entityId: input.negotiationId,
        actor: input.actor,
        payload: {
          counterAmountPaise: input.counterOfferAmountPaise,
          counterDueDate: input.counterOfferDueDate,
        },
      },
      client,
    );
  });
}

export async function acceptNegotiation(input: {
  negotiationId: string;
  businessId: string;
  actor: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const negRes = await client.query<any>(
      `SELECT * FROM payment_negotiations WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [input.negotiationId, input.businessId],
    );

    if (negRes.rows.length === 0) {
      throw new Error('Negotiation not found');
    }

    const neg = negRes.rows[0];
    const finalAmountPaise = neg.counter_offer_amount_paise || neg.proposed_amount_paise;
    const finalDueDate = neg.counter_offer_due_date || neg.proposed_due_date;

    await client.query(
      `UPDATE payment_negotiations
       SET status = 'ACCEPTED', updated_at = now()
       WHERE id = $1`,
      [input.negotiationId],
    );

    // Automatically synchronize into commitments table as an AGREED commitment with human evidence!
    const retailerId = neg.counterparty_type === 'RETAILER' ? neg.counterparty_id : null;
    const supplierId = neg.counterparty_type === 'SUPPLIER' ? neg.counterparty_id : null;
    const actionType = neg.counterparty_type === 'RETAILER' ? 'EARLY_RECEIPT' : 'SUPPLIER_DEFERRAL';

    await client.query(
      `INSERT INTO commitments (
        business_id, customer_invoice_id, supplier_bill_id, counterparty_type,
        retailer_id, supplier_id, action_type, proposed_amount_paise, proposed_date,
        agreed_amount_paise, agreed_date, due_date, status, human_reply_recorded,
        human_reply_by, human_reply_channel, human_reply_notes, human_replied_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9, $9, 'AGREED', true, $10, $11, $12, now())`,
      [
        input.businessId,
        neg.customer_invoice_id,
        neg.supplier_bill_id,
        neg.counterparty_type,
        retailerId,
        supplierId,
        actionType,
        finalAmountPaise,
        finalDueDate,
        input.actor,
        neg.channel,
        `Negotiation ${neg.id.slice(0, 8)} accepted and finalized into bilateral agreement.`,
      ],
    );

    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'NEGOTIATION_ACCEPTED_COMMITTED',
        entityType: 'payment_negotiations',
        entityId: input.negotiationId,
        actor: input.actor,
        payload: { agreedAmountPaise: finalAmountPaise, agreedDate: finalDueDate },
      },
      client,
    );
  });
}

export async function rejectNegotiation(input: {
  negotiationId: string;
  businessId: string;
  actor: string;
  reason?: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE payment_negotiations
     SET status = 'REJECTED', updated_at = now()
     WHERE id = $1 AND business_id = $2`,
    [input.negotiationId, input.businessId],
  );
}
