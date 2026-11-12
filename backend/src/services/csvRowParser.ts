import { parse as parseCsv } from 'csv-parse/sync';
import {
  findForbiddenCredentialKey,
  parseIsoDate,
  parsePaise,
  paiseToString,
  rupeesToPaise,
  type IdentifierType,
  type PaymentDirection,
  type PaymentMethod,
} from '@flowbridge/shared';
import type { IncomingPaymentInput } from './paymentService.js';

export const MAX_CSV_BYTES = 1_500_000;
export const MAX_CSV_ROWS = 2000;

export interface CsvParsedRowOutcome {
  rowNumber: number;
  input: IncomingPaymentInput | null;
  error: string | null;
}

function normalizeDirection(raw: string | undefined): PaymentDirection {
  const val = (raw ?? 'INFLOW').trim().toUpperCase();
  if (val === 'INFLOW' || val === 'CREDIT' || val === 'CR') return 'INFLOW';
  if (val === 'OUTFLOW' || val === 'DEBIT' || val === 'DR') return 'OUTFLOW';
  throw new Error(`Unsupported direction "${raw}" (expected INFLOW/CREDIT or OUTFLOW/DEBIT)`);
}

function normalizeMethod(raw: string | undefined): PaymentMethod {
  const val = (raw ?? 'UPI').trim().toUpperCase();
  if (val === 'UPI') return 'UPI';
  if (
    val === 'BANK_TRANSFER' ||
    val === 'NEFT' ||
    val === 'RTGS' ||
    val === 'IMPS' ||
    val === 'BANK'
  ) {
    return 'BANK_TRANSFER';
  }
  if (val === 'OTHER') return 'OTHER';
  throw new Error(`Unsupported payment method "${raw}"`);
}

function parseRowAmountPaise(row: Record<string, string>): string {
  if (row.amount_paise && row.amount_paise.trim()) {
    const val = parsePaise(row.amount_paise.trim());
    if (val <= 0n) throw new Error('amount_paise must be strictly positive');
    return paiseToString(val);
  }
  const rupees = row.amount_inr ?? row.amount ?? '';
  if (!rupees.trim()) {
    throw new Error('Missing amount_paise or amount_inr column');
  }
  const val = rupeesToPaise(rupees);
  if (val <= 0n) throw new Error('amount_inr must be strictly positive');
  return paiseToString(val);
}

/**
 * Parse and validate bank transaction CSV headers and rows deterministically.
 */
export function parseBankCsvRows(csvText: string): {
  headers: string[];
  rows: CsvParsedRowOutcome[];
} {
  if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
    throw new Error(`CSV file exceeds maximum size (${MAX_CSV_BYTES} bytes).`);
  }

  let detectedHeaders: string[] = [];
  const records = parseCsv(csvText, {
    columns: (headers: string[]) => {
      detectedHeaders = headers.map((h) => h.trim().toLowerCase());
      return detectedHeaders;
    },
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (records.length > MAX_CSV_ROWS) {
    throw new Error(`CSV exceeds maximum row limit (${MAX_CSV_ROWS} rows).`);
  }

  const hasAmountHeader =
    detectedHeaders.includes('amount_paise') ||
    detectedHeaders.includes('amount_inr') ||
    detectedHeaders.includes('amount');
  const hasDateHeader =
    detectedHeaders.includes('value_date') || detectedHeaders.includes('date');

  if (!hasAmountHeader || !hasDateHeader) {
    throw new Error(
      'CSV missing required headers: must include (amount_paise or amount_inr) and (value_date or date).',
    );
  }

  const outcomes: CsvParsedRowOutcome[] = records.map((row, idx) => {
    const rowNumber = idx + 2;
    try {
      const forbidden = findForbiddenCredentialKey(row);
      if (forbidden) {
        throw new Error(`Forbidden sensitive credential column "${forbidden}" detected`);
      }

      const direction = normalizeDirection(row.direction ?? row.type);
      const paymentMethod = normalizeMethod(row.payment_method ?? row.method);
      const amountPaise = parseRowAmountPaise(row);
      const rawDate = (row.value_date ?? row.date ?? '').trim();
      const valueDate = parseIsoDate(rawDate);

      const rawTs = (
        row.transaction_timestamp ??
        row.timestamp ??
        `${valueDate}T09:00:00.000Z`
      ).trim();
      const parsedTs = new Date(rawTs);
      if (Number.isNaN(parsedTs.getTime())) {
        throw new Error(`Invalid transaction_timestamp "${rawTs}"`);
      }

      const payerIdentifierRaw =
        row.payer_identifier_raw?.trim() ||
        row.payer_identifier?.trim() ||
        row.payer_upi?.trim() ||
        row.payer_account?.trim() ||
        null;

      const rawIdType = (row.payer_identifier_type ?? '').trim().toUpperCase();
      let payerIdentifierType: IdentifierType | null = null;
      if (rawIdType === 'UPI_ID' || rawIdType === 'BANK_ACCOUNT') {
        payerIdentifierType = rawIdType;
      } else if (row.payer_upi?.trim()) {
        payerIdentifierType = 'UPI_ID';
      } else if (row.payer_account?.trim()) {
        payerIdentifierType = 'BANK_ACCOUNT';
      } else if (payerIdentifierRaw) {
        payerIdentifierType = payerIdentifierRaw.includes('@') ? 'UPI_ID' : 'BANK_ACCOUNT';
      }

      return {
        rowNumber,
        input: {
          direction,
          paymentMethod,
          externalTransactionReference:
            row.external_transaction_reference ??
            row.external_reference ??
            row.utr ??
            row.reference ??
            null,
          explicitInvoiceReference:
            row.invoice_reference ?? row.explicit_invoice_reference ?? null,
          payerIdentifierType,
          payerIdentifierRaw,
          payerDisplayName: row.payer_name ?? row.payer_display_name ?? null,
          narration: row.narration ?? row.description ?? '',
          amountPaise,
          transactionTimestamp: parsedTs.toISOString(),
          valueDate,
          sourceType: 'CSV_IMPORT',
        },
        error: null,
      };
    } catch (err) {
      return {
        rowNumber,
        input: null,
        error: (err as Error).message,
      };
    }
  });

  return { headers: detectedHeaders, rows: outcomes };
}
