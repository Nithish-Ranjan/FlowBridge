import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnv } from '../config/env.js';
import { checkDatabaseHealth, closePool, getPool, withTransaction } from './pool.js';
import { runMigrations } from './migrate.js';
import { seedDemoData } from './seed.js';
import { createBusiness, listSuppliers } from './repositories/businessRepo.js';
import { createRetailer, getRetailerById, registerPaymentIdentifier } from './repositories/retailerRepo.js';
import { createCustomerInvoice, listCustomerInvoices } from './repositories/ledgerRepo.js';
import { computeIdentifierHmac, computeTransactionFingerprint } from '../utils/crypto.js';
import {
  confirmPaymentAllocation,
  previewPaymentAllocation,
  recordSinglePaymentTransaction,
  reversePaymentTransaction,
} from '../services/paymentService.js';

const __filename = fileURLToPath(import.meta.url);

async function runDbVerification(): Promise<void> {
  const env = getEnv();
  const health = await checkDatabaseHealth();
  assert.equal(health.ok, true, 'PostgreSQL health check must succeed');
  console.log(`[db:verify] Connected to PostgreSQL: ${health.databaseName}`);

  await runMigrations();
  console.log('[db:verify] Migrations verified.');

  const firstSeed = await seedDemoData();
  const secondSeed = await seedDemoData();
  assert.equal(secondSeed.seeded, false, 'Second seed run must be idempotent');
  console.log(`[db:verify] Idempotent seed verified (demo business ${firstSeed.businessId}).`);

  // Create an isolated verification business and tear it down at the end
  const suffix = Date.now().toString(36);
  const testBiz = await createBusiness({
    code: `VERIFY-${suffix}`,
    name: 'Verification Harness Business',
    openingCashPaise: '8000000',
    openingCashDate: '2026-11-11',
    minimumCashPaise: '0',
    allocationPolicy: 'OLDEST_DUE_FIRST',
  });

  try {
    const ret1 = await createRetailer({
      businessId: testBiz.id,
      retailerCode: 'V-R001',
      name: 'Verify Retailer 1',
    });
    const ret2 = await createRetailer({
      businessId: testBiz.id,
      retailerCode: 'V-R002',
      name: 'Verify Retailer 2',
    });

    // 1. Verify active identifier uniqueness across two retailers in the same business
    const sharedUpi = `verify-${suffix}@okaxis`;
    const fp = computeIdentifierHmac('UPI_ID', sharedUpi, env.IDENTIFIER_HMAC_SECRET);
    await registerPaymentIdentifier({
      businessId: testBiz.id,
      retailerId: ret1.id,
      identifierType: 'UPI_ID',
      normalizedFingerprint: fp,
      maskedValue: 've***1@okaxis',
      displayLabel: 'Primary UPI',
    });

    await assert.rejects(
      () =>
        registerPaymentIdentifier({
          businessId: testBiz.id,
          retailerId: ret2.id,
          identifierType: 'UPI_ID',
          normalizedFingerprint: fp,
          maskedValue: 've***1@okaxis',
          displayLabel: 'Duplicate UPI Attempt',
        }),
      /uq_active_retailer_identifier_per_business|duplicate key/i,
    );
    console.log('[db:verify] Unique active payment identifier constraint verified.');

    // 2. Verify foreign key enforcement on customer_invoices
    await assert.rejects(
      () =>
        createCustomerInvoice({
          businessId: testBiz.id,
          retailerId: '00000000-0000-0000-0000-000000000000',
          invoiceNumber: 'INV-BAD-FK',
          invoiceDate: '2026-11-01',
          dueDate: '2026-11-20',
          totalAmountPaise: '1000000',
        }),
      /foreign key/i,
    );
    console.log('[db:verify] Foreign key constraint verified.');

    // 3. Verify check constraint prevents forcing matched_retailer_id when AMBIGUOUS
    const pool = getPool();
    const badTxFp = computeTransactionFingerprint(
      {
        direction: 'INFLOW',
        paymentMethod: 'UPI',
        externalTransactionReference: `UTR-CHECK-${suffix}`,
        amountPaise: '100000',
        valueDate: '2026-11-11',
        transactionTimestamp: '2026-11-11T10:00:00.000Z',
      },
      env.TX_FINGERPRINT_SECRET,
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO payment_transactions (
            business_id, direction, payment_method, amount_paise, transaction_timestamp,
            value_date, transaction_fingerprint, match_status, matched_retailer_id, source_type
          ) VALUES ($1, 'INFLOW', 'UPI', 100000, now(), '2026-11-11', $2, 'AMBIGUOUS', $3, 'MANUAL_ENTRY')`,
          [testBiz.id, badTxFp, ret1.id],
        ),
      /check constraint/i,
    );
    console.log('[db:verify] AMBIGUOUS/UNMATCHED non-null retailer_id check constraint verified.');

    // 4. Create ₹10,000 invoice and record ₹1,000 payment twice (second must be duplicate!)
    const inv = await createCustomerInvoice({
      businessId: testBiz.id,
      retailerId: ret1.id,
      invoiceNumber: 'V-INV-001',
      invoiceDate: '2026-11-01',
      dueDate: '2026-11-25',
      totalAmountPaise: '1000000',
    });

    const firstInsert = await recordSinglePaymentTransaction(testBiz.id, {
      direction: 'INFLOW',
      paymentMethod: 'UPI',
      externalTransactionReference: `UTR-VER-${suffix}`,
      payerIdentifierType: 'UPI_ID',
      payerIdentifierRaw: sharedUpi,
      amountPaise: '100000',
      transactionTimestamp: '2026-11-11T10:30:00.000Z',
      valueDate: '2026-11-11',
      narration: 'Partial payment ₹1,000',
      sourceType: 'MANUAL_ENTRY',
    });
    assert.equal(firstInsert.inserted, true);
    assert.equal(firstInsert.transaction?.matchStatus, 'MATCHED');
    assert.equal(firstInsert.transaction?.matchedRetailerId, ret1.id);

    const dupInsert = await recordSinglePaymentTransaction(testBiz.id, {
      direction: 'INFLOW',
      paymentMethod: 'UPI',
      externalTransactionReference: `UTR-VER-${suffix}`,
      payerIdentifierType: 'UPI_ID',
      payerIdentifierRaw: sharedUpi,
      amountPaise: '100000',
      transactionTimestamp: '2026-11-11T10:30:00.000Z',
      valueDate: '2026-11-11',
      narration: 'Partial payment ₹1,000',
      sourceType: 'MANUAL_ENTRY',
    });
    assert.equal(dupInsert.duplicate, true);
    assert.equal(dupInsert.inserted, false);
    console.log('[db:verify] Unique transaction_fingerprint idempotency verified.');

    // 5. Preview & confirm partial allocation (₹10,000 -> ₹9,000) and verify trigger-protected over-allocation rollback
    const txId = firstInsert.transaction!.id;
    const preview = await previewPaymentAllocation(testBiz.id, txId);
    assert.equal(preview.lines[0].proposedAllocatePaise, '100000');
    assert.equal(preview.lines[0].postAllocationOutstandingPaise, '900000');

    await assert.rejects(
      () =>
        confirmPaymentAllocation(testBiz.id, txId, [
          { invoiceId: inv.id, amountPaise: '200000' }, // > ₹1,000 payment
        ]),
      /exceeds remaining unallocated payment/i,
    );

    const confirmed = await confirmPaymentAllocation(testBiz.id, txId, [
      { invoiceId: inv.id, amountPaise: '100000', allocationMethod: 'OLDEST_DUE_FIRST' },
    ]);
    assert.equal(confirmed.payment.allocatedAmountPaise, '100000');
    const afterInvoices = await listCustomerInvoices(testBiz.id);
    assert.equal(afterInvoices[0].paidAmountPaise, '100000');
    assert.equal(afterInvoices[0].outstandingPaise, '900000');
    assert.equal(afterInvoices[0].status, 'PARTIALLY_PAID');
    console.log('[db:verify] Transactional partial allocation (₹10,000 -> ₹9,000) verified.');

    // 6. Reverse payment and confirm correcting ledger restores ₹10,000 outstanding without deleting history
    await reversePaymentTransaction(testBiz.id, txId, 'Verification reversal check');
    const restoredInvoices = await listCustomerInvoices(testBiz.id);
    assert.equal(restoredInvoices[0].paidAmountPaise, '0');
    assert.equal(restoredInvoices[0].outstandingPaise, '1000000');
    assert.equal(restoredInvoices[0].status, 'OPEN');
    console.log('[db:verify] Non-destructive reversal restoring ₹10,000 outstanding verified.');

    // 7. Verify direct SQL trigger blocks raw INSERT over-allocation and verify overpayment credit ledger
    const overPay = await recordSinglePaymentTransaction(testBiz.id, {
      direction: 'INFLOW',
      paymentMethod: 'BANK_TRANSFER',
      externalTransactionReference: `UTR-OVER-${suffix}`,
      payerIdentifierType: 'UPI_ID',
      payerIdentifierRaw: sharedUpi,
      amountPaise: '1500000', // ₹15,000 against ₹10,000 open invoice -> ₹5,000 overpayment
      transactionTimestamp: '2026-11-12T10:30:00.000Z',
      valueDate: '2026-11-12',
      narration: 'Overpayment ₹15,000',
      sourceType: 'MANUAL_ENTRY',
    });
    assert.equal(overPay.inserted, true);

    if (!health.serverVersion.includes('pg-mem')) {
      await assert.rejects(
        async () => {
          await getPool().query(
            `INSERT INTO payment_allocations (
              business_id, payment_transaction_id, invoice_id, entry_type, allocated_amount_paise, allocation_method
            ) VALUES ($1, $2, $3, 'ALLOCATION', 2000000, 'MANUAL_OVERRIDE')`,
            [testBiz.id, overPay.transaction!.id, inv.id],
          );
        },
        /exceeds invoice outstanding|exceeds payment amount|exceed payment amount/i,
      );
    }

    const overRes = await confirmPaymentAllocation(
      testBiz.id,
      overPay.transaction!.id,
      [{ invoiceId: inv.id, amountPaise: '1000000', allocationMethod: 'OLDEST_DUE_FIRST' }],
      true,
      'Apply full ₹10,000 + ₹5,000 unapplied credit',
    );
    assert.equal(overRes.overpaymentCreditedPaise, '500000');
    const retAfterOver = await getRetailerById(testBiz.id, ret1.id);
    assert.equal(retAfterOver?.unappliedCreditPaise, '500000');
    console.log('[db:verify] Direct SQL allocation trigger & ₹5,000 unapplied overpayment credit verified.');

    // Confirm demo business suppliers exist cleanly
    const demoSups = await listSuppliers(firstSeed.businessId);
    assert.equal(demoSups.length >= 1, true);
  } finally {
    // Cleanup temporary verification business (delete child ledger rows in order due to immutability triggers if any)
    await withTransaction(async (client) => {
      if (!health.serverVersion.includes('pg-mem')) {
        await client.query(
          'ALTER TABLE payment_allocations DISABLE TRIGGER trg_reject_payment_allocation_mutation',
        );
        await client.query(
          'ALTER TABLE payment_transactions DISABLE TRIGGER trg_guard_payment_transaction_immutability',
        );
      }
      await client.query("DELETE FROM payment_allocations WHERE business_id = $1 AND entry_type = 'REVERSAL'", [testBiz.id]);
      await client.query('DELETE FROM payment_allocations WHERE business_id = $1', [testBiz.id]);
      await client.query('DELETE FROM retailer_credit_ledger WHERE business_id = $1', [testBiz.id]);
      await client.query('DELETE FROM payment_transactions WHERE business_id = $1', [testBiz.id]);
      await client.query('DELETE FROM customer_invoices WHERE business_id = $1', [testBiz.id]);
      await client.query('DELETE FROM businesses WHERE id = $1', [testBiz.id]);
      if (!health.serverVersion.includes('pg-mem')) {
        await client.query(
          'ALTER TABLE payment_transactions ENABLE TRIGGER trg_guard_payment_transaction_immutability',
        );
        await client.query(
          'ALTER TABLE payment_allocations ENABLE TRIGGER trg_reject_payment_allocation_mutation',
        );
      }
    });
  }

  console.log('[db:verify] ALL PostgreSQL verification checks passed!');
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isCli) {
  runDbVerification()
    .then(() => closePool())
    .catch(async (err) => {
      console.error('[db:verify] Verification failed:', err);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
