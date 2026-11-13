/**
 * Pure calendar ISO-8601 date (YYYY-MM-DD) helpers.
 * Uses UTC calendar arithmetic so local timezone offsets never shift due dates.
 */

export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseParts(iso: string | Date | unknown): { year: number; month: number; day: number } {
  const str =
    iso instanceof Date
      ? iso.toISOString().slice(0, 10)
      : typeof iso === 'string'
        ? iso.trim()
        : String(iso ?? '').trim();
  const match = ISO_DATE_RE.exec(str);
  if (!match) {
    throw new Error(`Invalid ISO date (expected YYYY-MM-DD): "${String(iso)}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${iso}"`);
  }
  return { year, month, day };
}

export function parseIsoDate(input: string): IsoDate {
  const { year, month, day } = parseParts(input);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidIsoDate(input: string): boolean {
  try {
    parseParts(input);
    return true;
  } catch {
    return false;
  }
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) {
    throw new Error(`Days offset must be an integer, got ${days}`);
  }
  const { year, month, day } = parseParts(iso);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDays(fromIso: IsoDate, toIso: IsoDate): number {
  const a = parseParts(fromIso);
  const b = parseParts(toIso);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / 86_400_000);
}

export function compareIsoDate(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  const normA = parseIsoDate(a);
  const normB = parseIsoDate(b);
  if (normA < normB) return -1;
  if (normA > normB) return 1;
  return 0;
}

export function dateRange(startIso: IsoDate, horizonDays: number): IsoDate[] {
  if (!Number.isInteger(horizonDays) || horizonDays < 0) {
    throw new Error(`horizonDays must be a non-negative integer, got ${horizonDays}`);
  }
  const dates: IsoDate[] = [];
  for (let i = 0; i <= horizonDays; i += 1) {
    dates.push(addDays(startIso, i));
  }
  return dates;
}

/**
 * Normalize a timestamp string into an ISO-8601 UTC timestamp with explicit offset/Z.
 */
export function normalizeTimestamp(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp: "${input}"`);
  }
  return parsed.toISOString();
}

