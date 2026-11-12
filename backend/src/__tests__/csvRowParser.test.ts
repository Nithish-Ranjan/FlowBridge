import { describe, expect, it } from 'vitest';
import { MAX_CSV_BYTES, parseBankCsvRows } from '../services/csvRowParser.js';

describe('Bank CSV Row Parser', () => {
  it('parses mixed UPI and bank transfer rows using integer paise or exact INR conversion', () => {
    const csv = [
      'direction,payment_method,external_transaction_reference,explicit_invoice_reference,payer_identifier_raw,payer_display_name,narration,amount_inr,transaction_timestamp,value_date',
      'INFLOW,UPI,UTR-1001,C-3301,kirana.trader@okaxis,Metro Kirana,UPI receipt C-3301,1000.00,2026-11-11T10:15:00+05:30,2026-11-11',
      'INFLOW,NEFT,NEFT-2002,,SBIN0001234-445566,Apex Store,NEFT settlement,2500.50,2026-11-11T12:00:00Z,2026-11-11',
    ].join('\n');

    const parsed = parseBankCsvRows(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].error).toBeNull();
    expect(parsed.rows[0].input?.amountPaise).toBe('100000');
    expect(parsed.rows[0].input?.payerIdentifierType).toBe('UPI_ID');
    expect(parsed.rows[0].input?.explicitInvoiceReference).toBe('C-3301');

    expect(parsed.rows[1].error).toBeNull();
    expect(parsed.rows[1].input?.paymentMethod).toBe('BANK_TRANSFER');
    expect(parsed.rows[1].input?.amountPaise).toBe('250050');
    expect(parsed.rows[1].input?.payerIdentifierType).toBe('BANK_ACCOUNT');
  });

  it('throws when required amount or date headers are missing', () => {
    const badCsv = 'narration,payer_display_name\nPayment,Metro Kirana\n';
    expect(() => parseBankCsvRows(badCsv)).toThrow(/missing required headers/i);
  });

  it('rejects CSV payloads exceeding 1.5 MB byte limit', () => {
    const huge = 'amount_paise,value_date\n' + '100000,2026-11-11\n'.repeat(100_000);
    expect(Buffer.byteLength(huge, 'utf8')).toBeGreaterThan(MAX_CSV_BYTES);
    expect(() => parseBankCsvRows(huge)).toThrow(/exceeds maximum size/i);
  });

  it('rejects rows with invalid calendar dates without failing valid rows in the same batch', () => {
    const csv = [
      'amount_paise,value_date,narration',
      '100000,2026-11-11,Valid row',
      '200000,2026-02-30,Impossible calendar date',
    ].join('\n');

    const parsed = parseBankCsvRows(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].error).toBeNull();
    expect(parsed.rows[1].error).toMatch(/invalid calendar date|date/i);
  });

  it('flags rows carrying forbidden credential column headers such as upi_pin', () => {
    const csv = [
      'amount_paise,value_date,narration,upi_pin',
      '100000,2026-11-11,Bad row carrying credential column,9988',
    ].join('\n');

    const parsed = parseBankCsvRows(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].error).toMatch(/forbidden.*credential/i);
  });
});
