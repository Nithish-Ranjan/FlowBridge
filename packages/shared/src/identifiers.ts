import type { IdentifierType } from './types.js';

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  'pin',
  'upipin',
  'upi_pin',
  'mpin',
  'atmpin',
  'atm_pin',
  'otp',
  'password',
  'passwd',
  'passcode',
  'cvv',
  'cvc',
  'cardnumber',
  'card_number',
  'expiry',
  'netbankingpassword',
  'netbanking_password',
  'secretpin',
]);

const UPI_REGEX = /^[a-z0-9._-]{2,256}@[a-z0-9.-]{2,64}$/;

/**
 * Recursively check an untrusted object/payload for forbidden secret/banking credential fields.
 * Returns the first offending key name if found, or null when safe.
 */
export function findForbiddenCredentialKey(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const hit = findForbiddenCredentialKey(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (FORBIDDEN_CREDENTIAL_KEYS.has(normalizedKey)) {
      return key;
    }
    const nested = findForbiddenCredentialKey(value);
    if (nested) return nested;
  }
  return null;
}

/**
 * Normalize a payment identifier string into canonical form prior to server-side HMAC hashing.
 * Never store or return raw account numbers unmasked.
 */
export function normalizeIdentifierValue(type: IdentifierType, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error('Payment identifier value cannot be empty.');
  }

  if (type === 'UPI_ID') {
    const lower = trimmed.toLowerCase();
    if (!UPI_REGEX.test(lower)) {
      throw new Error(`Invalid UPI ID format: "${maskPaymentIdentifier('UPI_ID', trimmed)}"`);
    }
    return `UPI_ID:${lower}`;
  }

  // BANK_ACCOUNT: accept formats like "HDFC0001234:1234567890" or "IFSC-ACCT" or alphanumeric ref
  const cleaned = trimmed.toUpperCase().replace(/[\s-]+/g, ':').replace(/[^A-Z0-9:]/g, '');
  if (cleaned.length < 4) {
    throw new Error('Bank account reference must contain at least 4 alphanumeric characters.');
  }
  return `BANK_ACCOUNT:${cleaned}`;
}

/**
 * Produce a safe masked display string for a UPI ID or bank account reference.
 */
export function maskPaymentIdentifier(type: IdentifierType, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (type === 'UPI_ID') {
    const lower = trimmed.toLowerCase();
    const atIdx = lower.indexOf('@');
    if (atIdx <= 0) {
      return `${lower.slice(0, 2)}***`;
    }
    const local = lower.slice(0, atIdx);
    const domain = lower.slice(atIdx);
    if (local.length <= 2) {
      return `${local[0] ?? '*'}***${domain}`;
    }
    return `${local.slice(0, 2)}***${local.slice(-1)}${domain}`;
  }

  const alnum = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (alnum.length <= 4) {
    return `XXXX${alnum}`;
  }
  const last4 = alnum.slice(-4);
  const prefix = alnum.slice(0, Math.min(4, alnum.length - 4));
  return `${prefix}••••${last4}`;
}

