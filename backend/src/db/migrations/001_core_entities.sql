-- 001_core_entities.sql
-- Core FlowBridge entities: businesses, retailers, verified payment identifiers,
-- suppliers, customer invoices, supplier bills, and operating expenses.
-- All monetary amounts are stored strictly as BIGINT integer paise (INR * 100).

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  opening_cash_paise BIGINT NOT NULL,
  opening_cash_date DATE NOT NULL,
  minimum_cash_paise BIGINT NOT NULL DEFAULT 0,
  allocation_policy TEXT NOT NULL DEFAULT 'OLDEST_DUE_FIRST'
    CHECK (allocation_policy IN ('OLDEST_DUE_FIRST', 'EXPLICIT_THEN_OLDEST_DUE_FIRST')),
  approval_limits_json JSONB NOT NULL DEFAULT '{
    "maxEarlyRequestPct": 100,
    "maxEarlyDays": 14,
    "defaultMaxSupplierDeferralPct": 40,
    "defaultMaxSupplierDeferralDays": 10,
    "protectEssentialExpenses": true,
    "maxActionsPerPlan": 2
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS retailers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_code TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone_masked TEXT,
  email TEXT,
  credit_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (credit_terms_days >= 0),
  reliability_score INTEGER NOT NULL DEFAULT 80 CHECK (reliability_score BETWEEN 0 AND 100),
  unapplied_credit_paise BIGINT NOT NULL DEFAULT 0 CHECK (unapplied_credit_paise >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HOLD', 'INACTIVE')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, retailer_code),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_retailers_business ON retailers (business_id);

CREATE TRIGGER trg_retailers_updated_at
  BEFORE UPDATE ON retailers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS retailer_payment_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('UPI_ID', 'BANK_ACCOUNT')),
  normalized_fingerprint TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  display_label TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (retailer_id, business_id) REFERENCES retailers(id, business_id) ON DELETE CASCADE
);

-- Enforce that the same active payment identifier cannot be assigned to two different retailers in the same business
CREATE UNIQUE INDEX uq_active_retailer_identifier_per_business
  ON retailer_payment_identifiers (business_id, normalized_fingerprint)
  WHERE is_active = true;

CREATE INDEX idx_retailer_identifiers_lookup
  ON retailer_payment_identifiers (business_id, normalized_fingerprint)
  WHERE is_active = true AND verified_at IS NOT NULL;

CREATE INDEX idx_retailer_identifiers_retailer
  ON retailer_payment_identifiers (retailer_id);

CREATE TRIGGER trg_retailer_payment_identifiers_updated_at
  BEFORE UPDATE ON retailer_payment_identifiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_code TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone_masked TEXT,
  email TEXT,
  max_deferral_days INTEGER NOT NULL DEFAULT 7 CHECK (max_deferral_days >= 0),
  max_deferral_pct INTEGER NOT NULL DEFAULT 30 CHECK (max_deferral_pct BETWEEN 0 AND 100),
  is_critical BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, supplier_code),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_suppliers_business ON suppliers (business_id);

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS customer_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount_paise BIGINT NOT NULL CHECK (total_amount_paise > 0),
  paid_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_paise >= 0 AND paid_amount_paise <= total_amount_paise),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'WRITTEN_OFF')),
  evidence_status TEXT NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (evidence_status IN ('UNCONFIRMED', 'CONFIRMED_PROMISE', 'DISPUTED', 'VERIFIED_PAID')),
  external_reference TEXT,
  record_origin TEXT NOT NULL DEFAULT 'SEEDED_DEMO'
    CHECK (record_origin IN ('SEEDED_DEMO', 'MANUAL_ENTRY', 'CSV_IMPORT')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (retailer_id, business_id) REFERENCES retailers(id, business_id) ON DELETE RESTRICT,
  UNIQUE (business_id, invoice_number),
  UNIQUE (id, business_id),
  CHECK (due_date >= invoice_date)
);

CREATE INDEX idx_customer_invoices_business_due ON customer_invoices (business_id, due_date);
CREATE INDEX idx_customer_invoices_retailer_due ON customer_invoices (retailer_id, due_date);
CREATE INDEX idx_customer_invoices_ext_ref
  ON customer_invoices (business_id, upper(external_reference))
  WHERE external_reference IS NOT NULL;

CREATE TRIGGER trg_customer_invoices_updated_at
  BEFORE UPDATE ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS supplier_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL,
  bill_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount_paise BIGINT NOT NULL CHECK (total_amount_paise > 0),
  paid_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_paise >= 0 AND paid_amount_paise <= total_amount_paise),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'DEFERRED', 'CANCELLED')),
  evidence_status TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (evidence_status IN ('CONFIRMED', 'DISPUTED', 'VERIFIED_PAID')),
  priority_tier TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority_tier IN ('ESSENTIAL', 'NORMAL', 'FLEXIBLE')),
  record_origin TEXT NOT NULL DEFAULT 'SEEDED_DEMO'
    CHECK (record_origin IN ('SEEDED_DEMO', 'MANUAL_ENTRY', 'CSV_IMPORT')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (supplier_id, business_id) REFERENCES suppliers(id, business_id) ON DELETE RESTRICT,
  UNIQUE (business_id, bill_number),
  UNIQUE (id, business_id),
  CHECK (due_date >= issue_date)
);

CREATE INDEX idx_supplier_bills_business_due ON supplier_bills (business_id, due_date);

CREATE TRIGGER trg_supplier_bills_updated_at
  BEFORE UPDATE ON supplier_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS operating_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expense_code TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  due_date DATE NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  paid_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_paise >= 0 AND paid_amount_paise <= amount_paise),
  status TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED', 'PAID', 'DEFERRED', 'CANCELLED')),
  priority_tier TEXT NOT NULL DEFAULT 'ESSENTIAL'
    CHECK (priority_tier IN ('ESSENTIAL', 'NORMAL', 'DEFERRABLE')),
  is_protected BOOLEAN NOT NULL DEFAULT true,
  record_origin TEXT NOT NULL DEFAULT 'SEEDED_DEMO'
    CHECK (record_origin IN ('SEEDED_DEMO', 'MANUAL_ENTRY', 'CSV_IMPORT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, expense_code),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_operating_expenses_business_due ON operating_expenses (business_id, due_date);

CREATE TRIGGER trg_operating_expenses_updated_at
  BEFORE UPDATE ON operating_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

