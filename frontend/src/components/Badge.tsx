import type { DataClassification, MatchStatus, RecordOrigin } from '@flowbridge/shared';

export function ClassificationBadge({ type }: { type: DataClassification }) {
  const cls =
    type === 'ACTUAL'
      ? 'badge badge-actual'
      : type === 'SCENARIO'
        ? 'badge badge-scenario'
        : 'badge badge-expected';
  return <span className={cls}>{type}</span>;
}

export function OriginBadge({ origin }: { origin: RecordOrigin | string }) {
  const label =
    origin === 'CSV_IMPORT'
      ? 'IMPORTED CSV'
      : origin === 'MANUAL_ENTRY'
        ? 'MANUAL DEMO'
        : 'SEEDED DEMO';
  return <span className="badge badge-neutral">{label}</span>;
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const cls =
    status === 'MATCHED'
      ? 'badge badge-actual'
      : status === 'AMBIGUOUS'
        ? 'badge badge-danger'
        : 'badge badge-expected';
  return <span className={cls}>{status}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const dangerSet = new Set([
    'FAILED',
    'AT_RISK',
    'DISPUTED',
    'OVERDUE',
    'NO_FEASIBLE_PLAN',
    'MISSED',
    'MISSED_COMMITMENT',
    'DELAYED_INVOICE',
    'REVERSED',
  ]);
  const goodSet = new Set([
    'AGREED',
    'COMPLETED',
    'PAID',
    'VERIFIED',
    'VERIFIED_PAID',
    'ALLOCATED',
    'FEASIBLE_PLANS_FOUND',
    'MATCHED',
    'ON_TRACK',
    'RECONCILED',
  ]);
  const warnSet = new Set([
    'PROPOSED',
    'UNCONFIRMED',
    'PARTIALLY_PAID',
    'PARTIALLY_ALLOCATED',
    'PENDING_REVIEW',
    'UNAPPLIED',
    'PARTIAL',
    'UNKNOWN_NEEDS_REVIEW',
    'PENDING_FUTURE',
  ]);

  const cls = dangerSet.has(status)
    ? 'badge badge-danger'
    : goodSet.has(status)
      ? 'badge badge-actual'
      : warnSet.has(status)
        ? 'badge badge-expected'
        : 'badge badge-neutral';

  return <span className={cls}>{status}</span>;
}

