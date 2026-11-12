/**
 * Deterministic integer-paise financial arithmetic utilities.
 * All authoritative monetary calculations use TypeScript `bigint` (paise).
 * Floating-point arithmetic is never used for monetary values.
 */

export type PaiseString = string;

const INTEGER_PATTERN = /^-?\d+$/;
const RUPEE_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse an integer paise representation into `bigint`.
 * Accepts `bigint`, integer `number`, or integer decimal string.
 */
export function parsePaise(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Monetary paise number must be a safe integer, received: ${value}`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new Error(`Invalid integer paise string: "${value}"`);
  }
  return BigInt(trimmed);
}

/**
 * Convert a rupee decimal string (up to 2 decimal places, e.g. "1000", "1000.50", "-30000")
 * into exact `bigint` paise without using floating-point math.
 */
export function rupeesToPaise(input: string): bigint {
  const cleaned = input.replace(/,/g, '').replace(/₹/g, '').trim();
  const match = RUPEE_PATTERN.exec(cleaned);
  if (!match) {
    throw new Error(`Invalid INR rupee amount (max 2 decimals): "${input}"`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fracPadded = (match[3] ?? '').padEnd(2, '0');
  const frac = BigInt(fracPadded);
  return sign * (whole * 100n + frac);
}

/**
 * Serialize `bigint` paise to canonical decimal string for JSON/API transport.
 */
export function paiseToString(paise: bigint): PaiseString {
  return paise.toString(10);
}

/**
 * Convert integer paise (`bigint` or decimal string) into a clean INR decimal
 * string suitable for form inputs (e.g. "80000", "1000.50", "-30000") using
 * pure bigint arithmetic (zero floating-point operations).
 */
export function paiseToDecimalInput(value: bigint | string): string {
  const paise = typeof value === 'bigint' ? value : parsePaise(value);
  const isNegative = paise < 0n;
  const abs = isNegative ? -paise : paise;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const prefix = isNegative ? '-' : '';
  if (frac === 0n) {
    return `${prefix}${whole.toString(10)}`;
  }
  const fracStr = frac.toString(10).padStart(2, '0').replace(/0+$/, '');
  return `${prefix}${whole.toString(10)}.${fracStr}`;
}

/**
 * Format integer paise into Indian Rupee display string (e.g. "₹80,000.00", "-₹30,000.00").
 */
export function formatINR(value: bigint | string): string {
  const paise = typeof value === 'bigint' ? value : parsePaise(value);
  const isNegative = paise < 0n;
  const abs = isNegative ? -paise : paise;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString(10).padStart(2, '0');

  const digits = whole.toString(10);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const lastThree = digits.slice(-3);
    const rest = digits.slice(0, -3);
    const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${restGrouped},${lastThree}`;
  }

  return `${isNegative ? '-' : ''}₹${grouped}.${frac}`;
}

export function sumPaise(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const val of values) {
    total += val;
  }
  return total;
}

export function minPaise(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxPaise(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * Compute integer percentage of a paise amount using truncated integer division:
 * `(amountPaise * BigInt(pct)) / 100n`.
 */
export function percentageOfPaise(amountPaise: bigint, pct: number): bigint {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new Error(`Percentage must be an integer between 0 and 100, got ${pct}`);
  }
  return (amountPaise * BigInt(pct)) / 100n;
}

