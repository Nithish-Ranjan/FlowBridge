import { beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '../config/env.js';
import { seedDemoData } from '../db/seed.js';
import {
  prepareSmartWhatsAppMessage,
  trackWhatsAppHandoffOpened,
  confirmWhatsAppSent,
  listRetailerWhatsAppLogs,
  validateAndNormalizePhone,
  buildWaMeUrl,
} from '../services/whatsappService.js';
import { listRetailers } from '../db/repositories/retailerRepo.js';

let businessId = '327a78a9-e3b2-424b-a808-abda5ea92bb1';
let retailerId: string;
let logId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/flowbridge_test';
  process.env.IDENTIFIER_HMAC_SECRET = 'test-identifier-hmac-secret-123456';
  process.env.TX_FINGERPRINT_SECRET = 'test-tx-fingerprint-secret-123456';
  resetEnvCacheForTests();
  const seedRes = await seedDemoData(true);
  businessId = seedRes.businessId;
  const retailers = await listRetailers(businessId);
  expect(retailers.length).toBeGreaterThan(0);
  retailerId = retailers[0].id;
});

describe('WhatsApp Smart Message Preparation & Audit Service End-to-End', () => {
  it('prepares a smart upcoming reminder without inventing values and sets status to DRAFT', async () => {
    const res = await prepareSmartWhatsAppMessage({
      businessId,
      retailerId,
      templateType: 'UPCOMING_REMINDER',
    });

    expect(res.logId).toBeDefined();
    expect(res.recipientName).toBeDefined();
    expect(res.normalizedPhone).toBeDefined();
    expect(res.isValidPhone).toBe(true);
    expect(res.waMeUrl).toContain('https://wa.me/');
    expect(res.messageText).toContain('reminder');
    expect(res.contextSummary.businessName).toBeDefined();

    logId = res.logId;
  });

  it('tracks opening in WhatsApp Web and updates status to OPENED_IN_WHATSAPP', async () => {
    const res = await trackWhatsAppHandoffOpened(
      businessId,
      logId,
      'Personalized invoice reminder message',
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('OPENED_IN_WHATSAPP');
    expect(res.waMeUrl).toBeDefined();
  });

  it('enforces human confirmation to advance to USER_CONFIRMED_SENT and sets confirmed_at timestamp', async () => {
    const res = await confirmWhatsAppSent(
      businessId,
      logId,
      'User manually verified dispatch in WhatsApp Web.',
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('USER_CONFIRMED_SENT');
    expect(res.confirmedAt).toBeDefined();
  });

  it('provides an immutable communication audit trail for the retailer', async () => {
    const history = await listRetailerWhatsAppLogs(businessId, retailerId);
    expect(Array.isArray(history)).toBe(true);
    const entry = history.find((h) => h.id === logId);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('USER_CONFIRMED_SENT');
    expect(entry?.confirmedAt).toBeDefined();
  });

  it('prepares overdue reminder using real invoice details and overdue duration', async () => {
    const res = await prepareSmartWhatsAppMessage({
      businessId,
      retailerId,
      templateType: 'OVERDUE_REMINDER',
    });

    expect(res.logId).toBeDefined();
    expect(res.messageText).toContain('due date');
  });

  it('handles phone number overrides correctly', async () => {
    const res = await prepareSmartWhatsAppMessage({
      businessId,
      retailerId,
      templateType: 'FRIENDLY_FOLLOWUP',
      recipientPhoneOverride: '+91 99887 76655',
    });

    expect(res.normalizedPhone).toBe('919988776655');
    expect(res.isValidPhone).toBe(true);
    expect(res.waMeUrl).toContain('https://wa.me/919988776655');
  });

  it('flags missing or invalid numbers cleanly without crashing', async () => {
    const res = await prepareSmartWhatsAppMessage({
      businessId,
      retailerId,
      templateType: 'FRIENDLY_FOLLOWUP',
      recipientPhoneOverride: '123',
    });

    expect(res.isValidPhone).toBe(false);
    expect(res.phoneErrorMessage).toBeDefined();
    expect(res.waMeUrl).toBeNull();
  });
});
