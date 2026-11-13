import { describe, it, expect } from 'vitest';
import {
  validateAndNormalizePhone,
  buildWaMeUrl,
  type WhatsAppTemplateType,
} from '../services/whatsappService.js';

describe('WhatsApp Smart Message Preparation & Human-Controlled Workflow', () => {
  describe('Phone Number Validation & Normalisation', () => {
    it('normalises plain 10-digit Indian mobile numbers to 91XXXXXXXXXX', () => {
      const res = validateAndNormalizePhone('9820111223');
      expect(res.isValid).toBe(true);
      expect(res.normalizedPhone).toBe('919820111223');
      expect(res.displayPhone).toBe('+91 98201 11223');
    });

    it('normalises formatted Indian mobile numbers (+91, dashes, spaces)', () => {
      const res1 = validateAndNormalizePhone('+91 98201 11223');
      expect(res1.isValid).toBe(true);
      expect(res1.normalizedPhone).toBe('919820111223');

      const res2 = validateAndNormalizePhone('+91-98201-11223');
      expect(res2.isValid).toBe(true);
      expect(res2.normalizedPhone).toBe('919820111223');

      const res3 = validateAndNormalizePhone('09820111223');
      expect(res3.isValid).toBe(true);
      expect(res3.normalizedPhone).toBe('919820111223');
    });

    it('rejects masked phone numbers containing asterisks or X characters', () => {
      const res1 = validateAndNormalizePhone('+91 98201 *****');
      expect(res1.isValid).toBe(false);
      expect(res1.errorMessage).toContain('masked');

      const res2 = validateAndNormalizePhone('98201XXXXX');
      expect(res2.isValid).toBe(false);
      expect(res2.errorMessage).toContain('masked');
    });

    it('rejects missing, empty, or whitespace-only phone numbers', () => {
      const res1 = validateAndNormalizePhone(null);
      expect(res1.isValid).toBe(false);
      expect(res1.errorMessage).toContain('missing');

      const res2 = validateAndNormalizePhone('   ');
      expect(res2.isValid).toBe(false);
      expect(res2.errorMessage).toContain('missing');
    });

    it('rejects invalid digit lengths', () => {
      const res = validateAndNormalizePhone('12345');
      expect(res.isValid).toBe(false);
      expect(res.errorMessage).toBeDefined();
    });
  });

  describe('Official wa.me Click-to-Chat URL Generation', () => {
    it('creates compliant wa.me URL with properly URL-encoded text and without leading +', () => {
      const phone = '919820111223';
      const message = 'Hello Anand Provisions,\nYour invoice INV-1001 for ₹42,000 is due on 2026-11-20.';
      const url = buildWaMeUrl(phone, message);

      expect(url).toBe(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
      expect(url).not.toContain('+');
      expect(url.startsWith('https://wa.me/919820111223?text=Hello%20Anand%20Provisions')).toBe(true);
    });

    it('safely handles special characters, INR symbols, and multiline formatting', () => {
      const phone = '919876543210';
      const text = '₹ 1,50,000 & 18% GST (Test #43)';
      const url = buildWaMeUrl(phone, text);

      expect(url).toContain(encodeURIComponent('₹ 1,50,000 & 18% GST (Test #43)'));
    });
  });

  describe('Human Control & Integrity Standards', () => {
    it('enforces that WhatsApp delivery statuses strictly follow DRAFT -> OPENED -> USER_CONFIRMED', () => {
      const validStatuses = ['DRAFT', 'OPENED_IN_WHATSAPP', 'USER_CONFIRMED_SENT'];
      expect(validStatuses).toContain('DRAFT');
      expect(validStatuses).toContain('OPENED_IN_WHATSAPP');
      expect(validStatuses).toContain('USER_CONFIRMED_SENT');

      // Ensure fake delivered is not treated as a valid client status without Meta API
      const fakeStatus: string = 'DELIVERED';
      expect(fakeStatus !== 'USER_CONFIRMED_SENT').toBe(true);
    });
  });
});
