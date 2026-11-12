import {
  parsePaise,
  paiseToString,
  type AllocationMethod,
  type CustomerInvoiceDTO,
  type MatchEvidence,
  type MatchEvidenceCandidate,
  type MatchStatus,
  type PaymentDirection,
} from '@flowbridge/shared';
import type { AllocationPreviewLine } from './paymentService.js';

export function extractExplicitInvoiceCandidates(
  explicitRef: string | null | undefined,
  narration: string,
): string[] {
  const tokens = new Set<string>();
  if (explicitRef && explicitRef.trim()) {
    tokens.add(explicitRef.trim().toUpperCase());
  }
  const structuredMatches = narration
    .toUpperCase()
    .match(/\b(?:[A-Z]+-\d+(?:-[A-Z0-9]+)*|DEMO-[A-Z0-9-]+)\b/g);
  if (structuredMatches) {
    for (const m of structuredMatches) tokens.add(m);
  }
  const refPrefix = narration.match(/(?:INV|REF)\s*[:#]\s*([A-Za-z0-9-]+)/gi);
  if (refPrefix) {
    for (const m of refPrefix) {
      const val = m.split(/[:#]/)[1]?.trim().toUpperCase();
      if (val) tokens.add(val);
    }
  }
  return Array.from(tokens);
}

/**
 * Pure deterministic retailer identification decision from verified evidence candidates.
 * Never guesses by amount, date, or free-text payer name.
 */
export function decideRetailerMatch(
  direction: PaymentDirection,
  candidates: MatchEvidenceCandidate[],
): {
  matchStatus: MatchStatus;
  matchedRetailerId: string | null;
  matchEvidence: MatchEvidence;
} {
  if (direction !== 'INFLOW') {
    return {
      matchStatus: 'UNMATCHED',
      matchedRetailerId: null,
      matchEvidence: {
        decision: 'UNMATCHED',
        rule: 'OUTFLOW_NO_RETAILER_MATCH',
        explanation: 'Outflow bank transaction does not match against retailer receivables.',
        candidates: [],
      },
    };
  }

  const distinctRetailerIds = Array.from(new Set(candidates.map((c) => c.retailerId)));

  if (distinctRetailerIds.length === 0) {
    return {
      matchStatus: 'UNMATCHED',
      matchedRetailerId: null,
      matchEvidence: {
        decision: 'UNMATCHED',
        rule: 'NO_EXACT_REF_OR_VERIFIED_ID',
        explanation:
          'No explicit invoice reference or verified payer identifier matched. Flagged for human review (never guessed by amount, date, or name text).',
        candidates: [],
      },
    };
  }

  if (distinctRetailerIds.length > 1) {
    return {
      matchStatus: 'AMBIGUOUS',
      matchedRetailerId: null,
      matchEvidence: {
        decision: 'AMBIGUOUS',
        rule: 'CONFLICTING_MATCH_CANDIDATES',
        explanation: `Multiple distinct retailers (${distinctRetailerIds.length}) matched across explicit references / identifiers. Distributor must resolve ambiguity manually.`,
        candidates,
      },
    };
  }

  const chosenId = distinctRetailerIds[0];
  const reasons = Array.from(new Set(candidates.map((c) => c.reason))).join(' + ');
  const first = candidates[0];
  return {
    matchStatus: 'MATCHED',
    matchedRetailerId: chosenId,
    matchEvidence: {
      decision: 'MATCHED',
      rule: reasons,
      explanation: `Deterministic match to ${first.retailerCode} (${first.retailerName}) via ${reasons}.`,
      candidates,
    },
  };
}

/**
 * Compute allocation preview lines (explicit invoice first if referenced, otherwise oldest-due-first),
 * plus any unapplied overpayment credit remainder.
 */
export function computeAllocationPreviewLines(
  remainingPaymentPaise: string,
  openInvoicesSortedOldestFirst: CustomerInvoiceDTO[],
  explicitInvoiceReference: string | null | undefined,
  narration: string,
): {
  lines: AllocationPreviewLine[];
  totalProposedAllocatePaise: string;
  unappliedOverpaymentPaise: string;
} {
  const explicitTokens = new Set(extractExplicitInvoiceCandidates(explicitInvoiceReference, narration));
  const explicitInvoices = openInvoicesSortedOldestFirst.filter(
    (inv) =>
      explicitTokens.has(inv.invoiceNumber.toUpperCase()) ||
      (inv.externalReference && explicitTokens.has(inv.externalReference.toUpperCase())),
  );
  const otherInvoices = openInvoicesSortedOldestFirst.filter(
    (inv) => !explicitInvoices.some((e) => e.id === inv.id),
  );
  const ordered = [...explicitInvoices, ...otherInvoices];

  let left = parsePaise(remainingPaymentPaise);
  let totalAllocated = 0n;
  const lines: AllocationPreviewLine[] = [];

  for (const inv of ordered) {
    if (left <= 0n) break;
    const out = parsePaise(inv.outstandingPaise);
    if (out <= 0n) continue;
    const alloc = left < out ? left : out;
    left -= alloc;
    totalAllocated += alloc;

    const isExplicit = explicitInvoices.some((e) => e.id === inv.id);
    const method: AllocationMethod = isExplicit ? 'EXPLICIT_INVOICE' : 'OLDEST_DUE_FIRST';
    lines.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate,
      currentOutstandingPaise: inv.outstandingPaise,
      proposedAllocatePaise: paiseToString(alloc),
      postAllocationOutstandingPaise: paiseToString(out - alloc),
      allocationMethod: method,
    });
  }

  return {
    lines,
    totalProposedAllocatePaise: paiseToString(totalAllocated),
    unappliedOverpaymentPaise: paiseToString(left),
  };
}

