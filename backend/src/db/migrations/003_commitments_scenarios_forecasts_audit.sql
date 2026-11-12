-- 003_commitments_scenarios_forecasts_audit.sql
-- Isolated what-if scenarios, human-approved commitments, forecast snapshots, and audit events.

CREATE TABLE IF NOT EXISTS resolution_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scenario_kind TEXT NOT NULL DEFAULT 'RESOLUTION_PLAN'
    CHECK (scenario_kind IN ('BASELINE', 'RESOLUTION_PLAN', 'SHOCKWAVE_WHAT_IF', 'EMERGENCY_FALLBACK')),
  as_of_date DATE NOT NULL,
  horizon_days INTEGER NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 1 AND 365),
  is_feasible BOOLEAN,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SAVED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_resolution_scenarios_business ON resolution_scenarios (business_id, created_at DESC);

CREATE TRIGGER trg_resolution_scenarios_updated_at
  BEFORE UPDATE ON resolution_scenarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS scenario_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL,
  action_order INTEGER NOT NULL DEFAULT 1 CHECK (action_order >= 1),
  target_type TEXT NOT NULL
    CHECK (target_type IN ('CUSTOMER_INVOICE', 'SUPPLIER_BILL', 'OPERATING_EXPENSE', 'SYNTHETIC_ADJUSTMENT')),
  target_id UUID,
  target_label TEXT NOT NULL,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('ACCELERATE_INFLOW', 'DELAY_INFLOW', 'DROP_INFLOW_PCT', 'DEFER_OUTFLOW', 'SPLIT_OUTFLOW')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  original_date DATE,
  simulated_date DATE NOT NULL,
  within_approved_limits BOOLEAN NOT NULL DEFAULT true,
  limit_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (scenario_id, business_id) REFERENCES resolution_scenarios(id, business_id) ON DELETE CASCADE
);

CREATE INDEX idx_scenario_actions_scenario ON scenario_actions (scenario_id, action_order);

CREATE TABLE IF NOT EXISTS commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  counterparty_type TEXT NOT NULL CHECK (counterparty_type IN ('RETAILER', 'SUPPLIER', 'EXPENSE')),
  retailer_id UUID,
  customer_invoice_id UUID,
  supplier_id UUID,
  supplier_bill_id UUID,
  operating_expense_id UUID,
  scenario_id UUID,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('EARLY_RECEIPT', 'PARTIAL_COLLECTION', 'SUPPLIER_DEFERRAL', 'EXPENSE_DEFERRAL', 'PAYMENT_PLAN')),
  proposed_amount_paise BIGINT NOT NULL CHECK (proposed_amount_paise > 0),
  proposed_date DATE NOT NULL,
  agreed_amount_paise BIGINT CHECK (agreed_amount_paise IS NULL OR agreed_amount_paise > 0),
  agreed_date DATE,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED', 'AGREED', 'COMPLETED', 'FAILED', 'CANCELLED', 'AT_RISK')),
  human_reply_recorded BOOLEAN NOT NULL DEFAULT false,
  human_reply_by TEXT,
  human_reply_channel TEXT,
  human_reply_notes TEXT,
  human_replied_at TIMESTAMPTZ,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  fulfilled_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (fulfilled_amount_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (retailer_id, business_id) REFERENCES retailers(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_invoice_id, business_id) REFERENCES customer_invoices(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id, business_id) REFERENCES suppliers(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_bill_id, business_id) REFERENCES supplier_bills(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (operating_expense_id, business_id) REFERENCES operating_expenses(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (scenario_id, business_id) REFERENCES resolution_scenarios(id, business_id) ON DELETE SET NULL,
  -- A proposal is never an agreement until a human records the reply
  CHECK (
    (status = 'PROPOSED' AND human_reply_recorded = false)
    OR (status IN ('AGREED', 'COMPLETED', 'FAILED', 'AT_RISK') AND human_reply_recorded = true AND human_replied_at IS NOT NULL)
    OR (status = 'CANCELLED')
  )
);

CREATE INDEX idx_commitments_business_status ON commitments (business_id, status, due_date);

CREATE TRIGGER trg_commitments_updated_at
  BEFORE UPDATE ON commitments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scenario_id UUID,
  snapshot_label TEXT,
  data_classification TEXT NOT NULL DEFAULT 'ACTUAL_PLUS_EXPECTED'
    CHECK (data_classification IN ('ACTUAL_ONLY', 'ACTUAL_PLUS_EXPECTED', 'SCENARIO_WHAT_IF')),
  as_of_date DATE NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_days INTEGER NOT NULL CHECK (horizon_days BETWEEN 1 AND 365),
  first_breach_date DATE,
  minimum_balance_paise BIGINT NOT NULL,
  opening_cash_paise BIGINT NOT NULL,
  series_json JSONB NOT NULL,
  diagnostics_json JSONB NOT NULL,
  input_fingerprint TEXT NOT NULL,
  FOREIGN KEY (scenario_id, business_id) REFERENCES resolution_scenarios(id, business_id) ON DELETE SET NULL
);

CREATE INDEX idx_forecast_snapshots_business ON forecast_snapshots (business_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  actor TEXT NOT NULL DEFAULT 'SYSTEM',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_business ON audit_events (business_id, created_at DESC);
CREATE INDEX idx_audit_events_entity ON audit_events (entity_type, entity_id);

