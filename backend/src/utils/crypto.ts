import crypto from 'node:crypto';
import {
  normalizeIdentifierValue,
  parseIsoDate,
  parsePaise,
  type IdentifierType,
  type PaymentDirection,
  type PaymentMethod,
} from '@flowbridge/shared';

export function computeIdentifierHmac(
  type: IdentifierType,
  rawValue: string,
  secret: string,
): string {
  const canonical = normalizeIdentifierValue(type, rawValue);
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export interface FingerprintInput {
  direction: PaymentDirection;
  paymentMethod: PaymentMethod;
  externalTransactionReference?: string | null;
  amountPaise: string | bigint;
  valueDate: string;
  transactionTimestamp: string;
  payerIdentifierFingerprint?: string | null;
  narration?: string | null;
}

/**
 * Compute a stable keyed fingerprint for idempotent bank/payment imports.
 * Re-importing the exact same transaction yields the identical fingerprint,
 * allowing PostgreSQL UNIQUE (business_id, transaction_fingerprint) to block duplicate credit.
 */
export function computeTransactionFingerprint(
  input: FingerprintInput,
  secret: string,
): string {
  const amount = parsePaise(input.amountPaise).toString(10);
  const valueDate = parseIsoDate(input.valueDate);
  const extRef = (input.externalTransactionReference ?? '').trim().toUpperCase();
  const payerFp = (input.payerIdentifierFingerprint ?? '').trim().toLowerCase();
  const narrationNorm = (input.narration ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

  // When an external UTR / bank ref is present, include it as primary stable anchor;
  // otherwise include normalized ISO timestamp so two separate manual entries at different times stay distinct,
  // while re-uploading the same CSV row produces the exact same timestamp and fingerprint.
  const tsNorm = new Date(input.transactionTimestamp).toISOString();
  const canonical = extRef
    ? [input.direction, input.paymentMethod, extRef, amount, valueDate].join('|')
    : [input.direction, input.paymentMethod, amount, valueDate, tsNorm, payerFp, narrationNorm].join('|');

  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

