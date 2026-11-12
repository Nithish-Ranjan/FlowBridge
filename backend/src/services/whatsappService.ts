// whatsappService.ts
// Real WhatsApp Dual-Mode Integration Engine
// Mode A: WhatsApp Web Handoff (wa.me)
// Mode B: Meta WhatsApp Cloud API

import { query } from '../db/pool.js';

export interface WhatsAppConfig {
  mode: 'WEB_HAIL' | 'META_CLOUD_API';
  phoneNumberId?: string;
  accessToken?: string;
  webhookSecret?: string;
  isConfigured: boolean;
}

export interface SendWhatsAppOptions {
  businessId: string;
  recipientPhone: string;
  recipientName?: string;
  recipientType?: 'RETAILER' | 'SUPPLIER';
  messageText: string;
  templateKey?: string;
}

export interface WhatsAppSendResult {
  mode: 'WEB_HAIL' | 'META_CLOUD_API';
  success: boolean;
  handoffUrl?: string;
  externalMessageId?: string;
  error?: string;
}

export async function getBusinessWhatsAppConfig(businessId: string): Promise<WhatsAppConfig> {
  const res = await query<{ whatsapp_configurations: WhatsAppConfig }>(
    'SELECT whatsapp_configurations FROM businesses WHERE id = $1',
    [businessId],
  );
  if (!res.rows.length || !res.rows[0].whatsapp_configurations) {
    return {
      mode: 'WEB_HAIL',
      isConfigured: false,
    };
  }
  return res.rows[0].whatsapp_configurations;
}

export function formatIndianPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  return digits;
}

export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<WhatsAppSendResult> {
  const config = await getBusinessWhatsAppConfig(options.businessId);
  const cleanPhone = formatIndianPhoneNumber(options.recipientPhone);

  // Mode B: Meta WhatsApp Cloud API if configured
  if (config.mode === 'META_CLOUD_API' && config.isConfigured && config.phoneNumberId && config.accessToken) {
    try {
      const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { preview_url: false, body: options.messageText },
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json() as any;

      if (!resp.ok) {
        const errorMsg = data?.error?.message || 'Meta WhatsApp API returned an error';
        await logComm(options, 'FAILED', null, errorMsg);
        return {
          mode: 'META_CLOUD_API',
          success: false,
          error: errorMsg,
        };
      }

      const messageId = data?.messages?.[0]?.id || `meta-msg-${Date.now()}`;
      await logComm(options, 'SENT', messageId);

      return {
        mode: 'META_CLOUD_API',
        success: true,
        externalMessageId: messageId,
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      await logComm(options, 'FAILED', null, errorMsg);
      return {
        mode: 'META_CLOUD_API',
        success: false,
        error: errorMsg,
      };
    }
  }

  // Mode A: WhatsApp Web Handoff (wa.me)
  const encodedText = encodeURIComponent(options.messageText);
  const waMeUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

  await logComm(options, 'QUEUED', `wame-handoff-${Date.now()}`);

  return {
    mode: 'WEB_HAIL',
    success: true,
    handoffUrl: waMeUrl,
  };
}

async function logComm(
  options: SendWhatsAppOptions,
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED',
  externalId: string | null = null,
  errorDetails: string | null = null,
) {
  await query(
    `INSERT INTO communication_logs (
      business_id, recipient_type, recipient_name, recipient_address, channel, message_body, template_key, status, external_message_id, error_details
    ) VALUES ($1, $2, $3, $4, 'WHATSAPP', $5, $6, $7, $8, $9)`,
    [
      options.businessId,
      options.recipientType || 'RETAILER',
      options.recipientName || options.recipientPhone,
      options.recipientPhone,
      options.messageText,
      options.templateKey || 'GENERAL_NOTIFICATION',
      status,
      externalId,
      errorDetails,
    ],
  );
}
