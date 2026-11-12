import { describe, expect, it } from 'vitest';
import type { CustomerInvoiceDTO, MatchEvidenceCandidate } from '@flowbridge/shared';
import { computeIdentifierHmac, computeTransactionFingerprint } from '../utils/crypto.js';
import {
  computeAllocationPreviewLines,
  decideRetailerMatch,
  extractExplicitInvoiceCandidates,
} from '../services/paymentMatchingLogic.js';

const SECRET_ID = 'test-identifier-hmac-secret-123456';
const SECRET_TX = 'test-tx-fingerprint-secret-123456';

function sampleInvoices(): CustomerInvoiceDTO[] {
  return [
    {
      id: 'inv-1',
      businessId: 'biz-1',
      retailerId: 'ret-1',
      retailerCode: 'FB-R001',
      retailerName: 'Metro Kirana',
      invoiceNumber: 'INV-101',
      invoiceDate: '2026-10-01',
      dueDate: '2026-11-10',
      totalAmountPaise: '600000', // ₹6,000
      paidAmountPaise: '0',
      outstandingPaise: '600000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED_PROMISE',
      externalReference: 'INV-101',
      recordOrigin: 'MANUAL_ENTRY',
      notes: null,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'inv-2',
      businessId: 'biz-1',
      retailerId: 'ret-1',
      retailerCode: 'FB-R001',
      retailerName: 'Metro Kirana',
      invoiceNumber: 'INV-102',
      invoiceDate: '2026-10-15',
      dueDate: '2026-11-25',
      totalAmountPaise: '400000', // ₹4,000
      paidAmountPaise: '0',
      outstandingPaise: '400000',
      status: 'OPEN',
      evidenceStatus: 'CONFIRMED_PROMISE',
      externalReference: 'INV-102',
      recordOrigin: 'MANUAL_ENTRY',
      notes: null,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    },
  ];
}

describe('Transaction Fingerprint & Identifier HMAC', () => {
  it('produces identical transaction fingerprint for duplicate bank import rows', () => {
    const fp1 = computeTransactionFingerprint(
      {
        direction: 'INFLOW',
        paymentMethod: 'UPI',
        externalTransactionReference: ' utr99887766 ',
        amountPaise: '100000',
        valueDate: '2026-11-11',
        transactionTimestamp: '2026-11-11T09:00:00.000Z',
        narration: 'UPI payment from FB-R001',
      },
      SECRET_TX,
    );
    const fp2 = computeTransactionFingerprint(
      {
        direction: 'INFLOW',
        paymentMethod: 'UPI',
        externalTransactionReference: 'UTR99887766',
        amountPaise: '100000',
        valueDate: '2026-11-11',
        transactionTimestamp: '2026-11-11T14:30:00+05:30',
        narration: 'UPI   payment from FB-R001',
      },
      SECRET_TX,
    );
    expect(fp1).toBe(fp2);

    const fpDifferentAmount = computeTransactionFingerprint(
      {
        direction: 'INFLOW',
        paymentMethod: 'UPI',
        externalTransactionReference: 'UTR99887766',
        amountPaise: '200000',
        valueDate: '2026-11-11',
        transactionTimestamp: '2026-11-11T09:00:00.000Z',
      },
      SECRET_TX,
    );
    expect(fpDifferentAmount).not.toBe(fp1);
  });

  it('normalizes UPI IDs before computing deterministic HMAC', () => {
    const h1 = computeIdentifierHmac('UPI_ID', '  FB-R001.Demo@OKAXIS ', SECRET_ID);
    const h2 = computeIdentifierHmac('UPI_ID', 'fb-r001.demo@okaxis', SECRET_ID);
    expect(h1).toBe(h2);
  });
});

describe('Retailer Payment Identification Rules (No Guessing)', () => {
  it('marks payments with 0 exact/verified candidates as UNMATCHED', () => {
    const res = decideRetailerMatch('INFLOW', []);
    expect(res.matchStatus).toBe('UNMATCHED');
    expect(res.matchedRetailerId).toBeNull();
  });

  it('marks conflicting retailer candidates as AMBIGUOUS without forcing retailerId', () => {
    const candidates: MatchEvidenceCandidate[] = [
      {
        retailerId: 'ret-1',
        retailerCode: 'FB-R001',
        retailerName: 'Metro Kirana',
        reason: 'EXACT_VERIFIED_UPI_HMAC',
        matchedTokenMasked: 'fb***o@okaxis',
      },
      {
        retailerId: 'ret-2',
        retailerCode: 'RET-CUST-B',
        retailerName: 'Bharat Kirana',
        reason: 'EXPLICIT_INVOICE_REF',
        matchedTokenMasked: 'C-3307',
        invoiceId: 'inv-c3307',
        invoiceNumber: 'C-3307',
      },
    ];
    const res = decideRetailerMatch('INFLOW', candidates);
    expect(res.matchStatus).toBe('AMBIGUOUS');
    expect(res.matchedRetailerId).toBeNull();
    expect(res.matchEvidence.candidates).toHaveLength(2);
  });

  it('confirms deterministic MATCHED when multiple evidence signals agree on one retailer', () => {
    const candidates: MatchEvidenceCandidate[] = [
      {
        retailerId: 'ret-1',
        retailerCode: 'FB-R001',
        retailerName: 'Metro Kirana',
        reason: 'EXACT_VERIFIED_UPI_HMAC',
        matchedTokenMasked: 'fb***o@okaxis',
      },
      {
        retailerId: 'ret-1',
        retailerCode: 'FB-R001',
        retailerName: 'Metro Kirana',
        reason: 'EXPLICIT_INVOICE_REF',
        matchedTokenMasked: 'DEMO-R001-INV1',
      },
    ];
    const res = decideRetailerMatch('INFLOW', candidates);
    expect(res.matchStatus).toBe('MATCHED');
    expect(res.matchedRetailerId).toBe('ret-1');
    expect(res.matchEvidence.rule).toContain('EXACT_VERIFIED_UPI_HMAC');
  });

  it('extracts structured invoice tokens without guessing from ordinary text', () => {
    const tokens = extractExplicitInvoiceCandidates(null, 'UPI payment by Anand for INV:C-3301 partial');
    expect(tokens).toContain('C-3301');
  });
});

describe('Allocation Preview: Partial, Explicit Reference, and Overpayment Credit', () => {
  it('supports partial allocation (₹1,000 against ₹10,000 oldest invoice -> ₹9,000 remaining)', () => {
    const invoices = [
      {
        ...sampleInvoices()[0],
        invoiceNumber: 'DEMO-R001-INV1',
        totalAmountPaise: '1000000',
        outstandingPaise: '1000000',
      },
    ];
    const preview = computeAllocationPreviewLines('100000', invoices, null, 'Partial payment');
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].proposedAllocatePaise).toBe('100000');
    expect(preview.lines[0].postAllocationOutstandingPaise).toBe('900000');
    expect(preview.unappliedOverpaymentPaise).toBe('0');
  });

  it('prioritizes explicitly referenced invoice before oldest-due-first', () => {
    const preview = computeAllocationPreviewLines(
      '500000', // ₹5,000
      sampleInvoices(),
      'INV-102',
      'Paying INV-102 first',
    );
    expect(preview.lines[0].invoiceNumber).toBe('INV-102');
    expect(preview.lines[0].allocationMethod).toBe('EXPLICIT_INVOICE');
    expect(preview.lines[0].proposedAllocatePaise).toBe('400000'); // clears ₹4,000
    expect(preview.lines[1].invoiceNumber).toBe('INV-101');
    expect(preview.lines[1].allocationMethod).toBe('OLDEST_DUE_FIRST');
    expect(preview.lines[1].proposedAllocatePaise).toBe('100000'); // remaining ₹1,000
    expect(preview.unappliedOverpaymentPaise).toBe('0');
  });

  it('turns excess payment above all open invoices into unapplied overpayment credit', () => {
    const preview = computeAllocationPreviewLines(
      '1250000', // ₹12,500 against ₹10,000 total invoices
      sampleInvoices(),
      null,
      'Bulk advance settlement',
    );
    expect(preview.totalProposedAllocatePaise).toBe('1000000');
    expect(preview.unappliedOverpaymentPaise).toBe('250000'); // ₹2,500 unapplied retailer credit
  });
});

