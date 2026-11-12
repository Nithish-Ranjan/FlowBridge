-- 002_payments_and_allocations.sql
-- Bank import batches, immutable payment transaction source rows,
-- transactional payment allocations, and unapplied retailer credit / reversal ledger.

CREATE TABLE IF NOT EXISTS bank_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('CSV_IMPORT', 'MANUAL_ENTRY', 'SEEDED_DEMO')),
  filename TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'COMPLETED'
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL_WITH_ERRORS', 'FAILED')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  inserted_rows INTEGER NOT NULL DEFAULT 0 CHECK (inserted_rows >= 0),
  duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  error_rows INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  error_summary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_bank_import_batches_business ON bank_import_batches (business_id, imported_at DESC);

CREATE TRIGGER trg_bank_import_batches_updated_at
  BEFORE UPDATE ON bank_import_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  import_batch_id UUID,
  direction TEXT NOT NULL CHECK (direction IN ('INFLOW', 'OUTFLOW')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('UPI', 'BANK_TRANSFER', 'OTHER')),
  external_transaction_reference TEXT,
  explicit_invoice_reference TEXT,
  payer_identifier_fingerprint TEXT,
  payer_identifier_masked TEXT,
  payer_display_name TEXT,
  narration TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  allocated_amount_paise BIGINT NOT NULL DEFAULT 0
    CHECK (allocated_amount_paise >= 0 AND allocated_amount_paise <= amount_paise),
  unapplied_credit_paise BIGINT NOT NULL DEFAULT 0
    CHECK (unapplied_credit_paise >= 0),
  CHECK (allocated_amount_paise + unapplied_credit_paise <= amount_paise),
  transaction_timestamp TIMESTAMPTZ NOT NULL,
  value_date DATE NOT NULL,
  transaction_fingerprint TEXT NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'UNMATCHED'
    CHECK (match_status IN ('UNMATCHED', 'AMBIGUOUS', 'MATCHED')),
  matched_retailer_id UUID,
  match_evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  allocation_status TEXT NOT NULL DEFAULT 'UNAPPLIED'
    CHECK (allocation_status IN ('UNAPPLIED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'OVERPAYMENT_CREDITED', 'REVERSED')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (verification_status IN ('PENDING_REVIEW', 'VERIFIED', 'REVERSED')),
  source_type TEXT NOT NULL CHECK (source_type IN ('CSV_IMPORT', 'MANUAL_ENTRY', 'SEEDED_DEMO')),
  reversal_of_transaction_id UUID REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  is_reversed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (import_batch_id, business_id) REFERENCES bank_import_batches(id, business_id) ON DELETE SET NULL,
  FOREIGN KEY (matched_retailer_id, business_id) REFERENCES retailers(id, business_id) ON DELETE RESTRICT,
  -- Unmatched or ambiguous payments must never force a retailer_id; matched payments must have one
  CHECK (
    (match_status = 'MATCHED' AND matched_retailer_id IS NOT NULL)
    OR (match_status IN ('UNMATCHED', 'AMBIGUOUS') AND matched_retailer_id IS NULL)
  ),
  UNIQUE (business_id, transaction_fingerprint),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_payment_transactions_business_ts
  ON payment_transactions (business_id, transaction_timestamp DESC);
CREATE INDEX idx_payment_transactions_match_queue
  ON payment_transactions (business_id, match_status, allocation_status);
CREATE INDEX idx_payment_transactions_retailer
  ON payment_transactions (matched_retailer_id)
  WHERE matched_retailer_id IS NOT NULL;

CREATE TRIGGER trg_payment_transactions_updated_at
  BEFORE UPDATE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keep immutable source transaction attributes intact (prevent silent edits or deletions)
CREATE OR REPLACE FUNCTION guard_payment_transaction_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_transactions rows are immutable; record a reversal instead of deleting history.';
  END IF;

  IF NEW.business_id <> OLD.business_id
     OR NEW.direction <> OLD.direction
     OR NEW.payment_method <> OLD.payment_method
     OR NEW.amount_paise <> OLD.amount_paise
     OR NEW.transaction_timestamp <> OLD.transaction_timestamp
     OR NEW.transaction_fingerprint <> OLD.transaction_fingerprint
     OR NEW.source_type <> OLD.source_type THEN
    RAISE EXCEPTION 'Core source attributes on payment_transactions are immutable.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_payment_transaction_immutability
  BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_payment_transaction_immutability();

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_transaction_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'ALLOCATION' CHECK (entry_type IN ('ALLOCATION', 'REVERSAL')),
  allocated_amount_paise BIGINT NOT NULL CHECK (allocated_amount_paise <> 0),
  CHECK (
    (entry_type = 'ALLOCATION' AND allocated_amount_paise > 0)
    OR (entry_type = 'REVERSAL' AND allocated_amount_paise < 0)
  ),
  allocation_method TEXT NOT NULL
    CHECK (allocation_method IN ('EXPLICIT_INVOICE', 'OLDEST_DUE_FIRST', 'MANUAL_OVERRIDE')),
  reversed_allocation_id UUID REFERENCES payment_allocations(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (payment_transaction_id, business_id) REFERENCES payment_transactions(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id, business_id) REFERENCES customer_invoices(id, business_id) ON DELETE RESTRICT,
  CHECK (
    (entry_type = 'ALLOCATION' AND reversed_allocation_id IS NULL)
    OR (entry_type = 'REVERSAL' AND reversed_allocation_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_payment_allocation_reversed_once
  ON payment_allocations (reversed_allocation_id)
  WHERE reversed_allocation_id IS NOT NULL;

CREATE INDEX idx_payment_allocations_payment ON payment_allocations (payment_transaction_id, created_at);
CREATE INDEX idx_payment_allocations_invoice ON payment_allocations (invoice_id, created_at);

-- Prevent mutation or deletion of historical allocation rows
CREATE OR REPLACE FUNCTION reject_allocation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_allocations rows are immutable; insert a REVERSAL row instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_payment_allocation_mutation
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_allocation_mutation();

-- Database-level transactional integrity trigger for payment allocations and reversals
CREATE OR REPLACE FUNCTION enforce_payment_allocation_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_payment payment_transactions%ROWTYPE;
  v_invoice customer_invoices%ROWTYPE;
  v_orig payment_allocations%ROWTYPE;
  v_pay_allocated BIGINT;
  v_inv_paid BIGINT;
BEGIN
  SELECT * INTO v_payment
    FROM payment_transactions
    WHERE id = NEW.payment_transaction_id AND business_id = NEW.business_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment transaction % not found in business %', NEW.payment_transaction_id, NEW.business_id;
  END IF;

  SELECT * INTO v_invoice
    FROM customer_invoices
    WHERE id = NEW.invoice_id AND business_id = NEW.business_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer invoice % not found in business %', NEW.invoice_id, NEW.business_id;
  END IF;

  IF NEW.entry_type = 'ALLOCATION' THEN
    IF v_payment.direction <> 'INFLOW' THEN
      RAISE EXCEPTION 'Only INFLOW payments can be allocated to customer invoices.';
    END IF;
    IF v_payment.match_status <> 'MATCHED' OR v_payment.matched_retailer_id IS NULL THEN
      RAISE EXCEPTION 'Payment % must be MATCHED to a retailer before allocation.', v_payment.id;
    END IF;
    IF v_payment.matched_retailer_id <> v_invoice.retailer_id THEN
      RAISE EXCEPTION 'Payment retailer % does not match invoice retailer %.', v_payment.matched_retailer_id, v_invoice.retailer_id;
    END IF;
    IF v_payment.is_reversed THEN
      RAISE EXCEPTION 'Cannot allocate a reversed payment transaction.';
    END IF;
    IF v_invoice.status IN ('CANCELLED', 'WRITTEN_OFF') THEN
      RAISE EXCEPTION 'Cannot allocate payment to % invoice %.', v_invoice.status, v_invoice.invoice_number;
    END IF;
  ELSE
    SELECT * INTO v_orig
      FROM payment_allocations
      WHERE id = NEW.reversed_allocation_id;
    IF NOT FOUND OR v_orig.entry_type <> 'ALLOCATION' THEN
      RAISE EXCEPTION 'Reversal must reference a valid ALLOCATION row.';
    END IF;
    IF v_orig.payment_transaction_id <> NEW.payment_transaction_id OR v_orig.invoice_id <> NEW.invoice_id THEN
      RAISE EXCEPTION 'Reversal payment/invoice must match original allocation.';
    END IF;
    IF NEW.allocated_amount_paise <> -v_orig.allocated_amount_paise THEN
      RAISE EXCEPTION 'Reversal amount must exactly negate original allocation amount.';
    END IF;
  END IF;

  SELECT COALESCE(SUM(allocated_amount_paise), 0) INTO v_pay_allocated
    FROM payment_allocations
    WHERE payment_transaction_id = NEW.payment_transaction_id;

  IF v_pay_allocated < 0 OR (v_pay_allocated + v_payment.unapplied_credit_paise) > v_payment.amount_paise THEN
    RAISE EXCEPTION 'Aggregate payment allocations (%) plus unapplied credit (%) exceed payment amount (%)',
      v_pay_allocated, v_payment.unapplied_credit_paise, v_payment.amount_paise;
  END IF;

  SELECT COALESCE(SUM(allocated_amount_paise), 0) INTO v_inv_paid
    FROM payment_allocations
    WHERE invoice_id = NEW.invoice_id;

  IF v_inv_paid < 0 OR v_inv_paid > v_invoice.total_amount_paise THEN
    RAISE EXCEPTION 'Aggregate invoice paid (%) exceeds invoice total (%)',
      v_inv_paid, v_invoice.total_amount_paise;
  END IF;

  UPDATE customer_invoices
     SET paid_amount_paise = v_inv_paid,
         status = CASE
           WHEN v_inv_paid = 0 THEN 'OPEN'
           WHEN v_inv_paid < total_amount_paise THEN 'PARTIALLY_PAID'
           ELSE 'PAID'
         END,
         evidence_status = CASE
           WHEN v_inv_paid = total_amount_paise THEN 'VERIFIED_PAID'
           WHEN evidence_status = 'VERIFIED_PAID' AND v_inv_paid < total_amount_paise THEN 'CONFIRMED_PROMISE'
           ELSE evidence_status
         END
   WHERE id = v_invoice.id;

  UPDATE payment_transactions
     SET allocated_amount_paise = v_pay_allocated,
         allocation_status = CASE
           WHEN is_reversed THEN 'REVERSED'
           WHEN v_pay_allocated = 0 AND unapplied_credit_paise = 0 THEN 'UNAPPLIED'
           WHEN unapplied_credit_paise > 0 THEN 'OVERPAYMENT_CREDITED'
           WHEN v_pay_allocated < amount_paise THEN 'PARTIALLY_ALLOCATED'
           ELSE 'ALLOCATED'
         END
   WHERE id = v_payment.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_payment_allocation_integrity
  AFTER INSERT ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_integrity();

-- Immutable ledger for overpayment unapplied credits, applications, refunds, and reversals
CREATE TABLE IF NOT EXISTS retailer_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL,
  payment_transaction_id UUID,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('OVERPAYMENT_CREDIT', 'CREDIT_APPLIED', 'CREDIT_REVERSAL', 'REFUND')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
  CHECK (
    (entry_type = 'OVERPAYMENT_CREDIT' AND amount_paise > 0)
    OR (entry_type IN ('CREDIT_APPLIED', 'CREDIT_REVERSAL', 'REFUND') AND amount_paise < 0)
  ),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (retailer_id, business_id) REFERENCES retailers(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (payment_transaction_id, business_id) REFERENCES payment_transactions(id, business_id) ON DELETE RESTRICT
);

CREATE INDEX idx_retailer_credit_ledger_retailer ON retailer_credit_ledger (retailer_id, created_at);

CREATE OR REPLACE FUNCTION sync_retailer_unapplied_credit()
RETURNS TRIGGER AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_paise), 0) INTO v_balance
    FROM retailer_credit_ledger
    WHERE retailer_id = NEW.retailer_id;

  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Retailer unapplied credit balance cannot become negative (%).', v_balance;
  END IF;

  UPDATE retailers
     SET unapplied_credit_paise = v_balance
   WHERE id = NEW.retailer_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_retailer_unapplied_credit
  AFTER INSERT ON retailer_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION sync_retailer_unapplied_credit();

