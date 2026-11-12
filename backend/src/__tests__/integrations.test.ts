import { describe, it, expect, vi } from 'vitest';
import { parseIndianBankSms } from '../services/bankSmsParser.js';
import { formatIndianPhoneNumber } from '../services/whatsappService.js';
import { testSmtpConnection } from '../services/emailService.js';

describe('Integrations & Engine Verification', () => {
  it('formats Indian phone numbers correctly for WhatsApp Web and Cloud API', () => {
    expect(formatIndianPhoneNumber('9876543210')).toBe('919876543210');
    expect(formatIndianPhoneNumber('+91 98765 43210')).toBe('919876543210');
    expect(formatIndianPhoneNumber('+91-98765-43210')).toBe('919876543210');
    expect(formatIndianPhoneNumber('919876543210')).toBe('919876543210');
  });

  it('validates SMTP connection tester catches missing credentials cleanly', async () => {
    const res = await testSmtpConnection({
      smtpHost: 'smtp.example.com',
      smtpUser: '',
      smtpPass: '',
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain('required');
  });

  it('parses real multi-bank SMS and extracts integer paise accurately', () => {
    const hdfcMsg = 'HDFC Bank: Rs 20,000.00 credited to a/c **4012 on 11-Nov-26 by a/c linked to VPA custa@upi (UPI Ref no 431789214567). Bal: Rs 1,45,200.00';
    const parsed = parseIndianBankSms(hdfcMsg);
    expect(parsed).not.toBeNull();
    expect(parsed?.amountPaise).toBe(2000000);
    expect(parsed?.referenceNumber).toBe('431789214567');
    expect(parsed?.counterpartyHint).toBe('custa@upi');
  });
});

