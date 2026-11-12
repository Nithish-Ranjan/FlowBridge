import { describe, it, expect } from 'vitest';
import { parseIndianBankSms } from '../services/bankSmsParser.js';

describe('Real Indian Bank SMS Parser', () => {
  it('parses HDFC Bank UPI Credit SMS accurately', () => {
    const raw = 'HDFC Bank: Rs 25,000.00 credited to a/c **4012 on 11-Nov-26 by a/c linked to VPA ramesh@okhdfcbank (UPI Ref no 431789214567). Bal: Rs 1,45,200.00';
    const result = parseIndianBankSms(raw);

    expect(result).not.toBeNull();
    expect(result?.bank).toBe('HDFC');
    expect(result?.direction).toBe('CREDIT');
    expect(result?.amountPaise).toBe(2500000);
    expect(result?.accountTail).toBe('4012');
    expect(result?.referenceNumber).toBe('431789214567');
    expect(result?.counterpartyHint).toBe('ramesh@okhdfcbank');
    expect(result?.transactionDate).toBe('2026-11-11');
    expect(result?.confidenceScore).toBeGreaterThanOrEqual(90);
  });

  it('parses ICICI Bank UPI Credit SMS accurately', () => {
    const raw = 'Dear Customer, your Acct XX9021 has been credited with INR 15,500.00 on 10-Nov-26 by UPI/431788123999/Anand Kirana. Available Balance is INR 88,400.00.';
    const result = parseIndianBankSms(raw, 'VM-ICICIB');

    expect(result).not.toBeNull();
    expect(result?.bank).toBe('ICICI');
    expect(result?.direction).toBe('CREDIT');
    expect(result?.amountPaise).toBe(1550000);
    expect(result?.accountTail).toBe('9021');
    expect(result?.referenceNumber).toBe('431788123999');
    expect(result?.counterpartyHint).toBe('Anand Kirana');
    expect(result?.transactionDate).toBe('2026-11-10');
  });

  it('parses SBI (State Bank of India) Credit SMS accurately', () => {
    const raw = 'Your a/c no. XXXXXXXX1234 is credited by Rs 40,000.00 on 11Nov26 by transfer from Suresh UPI Ref 431899120033. Bal Rs: 92,300.00 - SBI';
    const result = parseIndianBankSms(raw);

    expect(result).not.toBeNull();
    expect(result?.bank).toBe('SBI');
    expect(result?.direction).toBe('CREDIT');
    expect(result?.amountPaise).toBe(4000000);
    expect(result?.accountTail).toBe('1234');
    expect(result?.referenceNumber).toBe('431899120033');
    expect(result?.counterpartyHint).toBe('Suresh');
  });

  it('parses Axis Bank Credit SMS accurately', () => {
    const raw = 'Axis Bank A/C XX4412 Credited for INR 12,000.00 on 11-11-2026 14:22:01 by UPI/431800112233/BHARAT MART. Avail Bal: INR 65,000.00.';
    const result = parseIndianBankSms(raw);

    expect(result).not.toBeNull();
    expect(result?.bank).toBe('AXIS');
    expect(result?.direction).toBe('CREDIT');
    expect(result?.amountPaise).toBe(1200000);
    expect(result?.accountTail).toBe('4412');
    expect(result?.referenceNumber).toBe('431800112233');
    expect(result?.counterpartyHint).toBe('BHARAT MART');
    expect(result?.transactionDate).toBe('2026-11-11');
  });

  it('parses Kotak Mahindra Bank Credit SMS accurately', () => {
    const raw = 'INR 18,250.00 credited to your Kotak Bank Ac 5678 on 11-Nov-26. UPI Ref no 431799221144. Info: UPI/ramesh@kotak. Balance: INR 1,12,000.00';
    const result = parseIndianBankSms(raw);

    expect(result).not.toBeNull();
    expect(result?.bank).toBe('KOTAK');
    expect(result?.direction).toBe('CREDIT');
    expect(result?.amountPaise).toBe(1825000);
    expect(result?.accountTail).toBe('5678');
    expect(result?.referenceNumber).toBe('431799221144');
    expect(result?.counterpartyHint).toBe('ramesh@kotak');
  });

  it('rejects spam or non-transactional messages', () => {
    const promo = 'Get pre-approved personal loan up to Rs 5 Lakhs! Click bit.ly/bankloan now.';
    expect(parseIndianBankSms(promo)).toBeNull();
  });
});
