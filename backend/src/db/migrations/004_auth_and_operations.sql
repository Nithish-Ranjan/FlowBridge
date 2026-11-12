-- 004_auth_and_operations.sql
-- Upgrades FlowBridge with Users & Auth, Emergency Reserve Management,
-- Credit Agreements, Structured Negotiations, Communication Logs, and Automation Rules.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'FINANCE_MANAGER', 'STAFF')),
  language_preference TEXT NOT NULL DEFAULT 'en' CHECK (language_preference IN ('en', 'hi', 'ta')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_business ON users (business_id);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_token ON user_sessions (token_hash);
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);

-- Emergency Reserve
CREATE TABLE IF NOT EXISTS reserve_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  target_reserve_paise BIGINT NOT NULL DEFAULT 0 CHECK (target_reserve_paise >= 0),
  current_reserve_paise BIGINT NOT NULL DEFAULT 0 CHECK (current_reserve_paise >= 0),
  minimum_threshold_paise BIGINT NOT NULL DEFAULT 0 CHECK (minimum_threshold_paise >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'DEPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_reserve_allocations_updated_at
  BEFORE UPDATE ON reserve_allocations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS reserve_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('DEPOSIT', 'WITHDRAWAL_EMERGENCY', 'SWEEP_INTO_RESERVE')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  authorized_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reserve_movements_business ON reserve_movements (business_id);

-- Retailer Credit Agreements
CREATE TABLE IF NOT EXISTS credit_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  agreement_number TEXT NOT NULL,
  credit_limit_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
  standard_term_days INTEGER NOT NULL DEFAULT 30 CHECK (standard_term_days >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_period_days >= 0),
  late_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (late_fee_pct >= 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
  valid_from DATE NOT NULL,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, agreement_number)
);

CREATE INDEX idx_credit_agreements_retailer ON credit_agreements (retailer_id);

CREATE TRIGGER trg_credit_agreements_updated_at
  BEFORE UPDATE ON credit_agreements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS credit_agreement_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES credit_agreements(id) ON DELETE CASCADE,
  customer_invoice_id UUID REFERENCES customer_invoices(id) ON DELETE SET NULL,
  milestone_date DATE NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'MET', 'DEFAULTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment Negotiations & Disputes
CREATE TABLE IF NOT EXISTS payment_negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_invoice_id UUID REFERENCES customer_invoices(id) ON DELETE SET NULL,
  supplier_bill_id UUID REFERENCES supplier_bills(id) ON DELETE SET NULL,
  counterparty_type TEXT NOT NULL CHECK (counterparty_type IN ('RETAILER', 'SUPPLIER')),
  counterparty_id UUID NOT NULL,
  counterparty_name TEXT NOT NULL,
  original_amount_paise BIGINT NOT NULL CHECK (original_amount_paise > 0),
  original_due_date DATE NOT NULL,
  proposed_amount_paise BIGINT NOT NULL CHECK (proposed_amount_paise > 0),
  proposed_due_date DATE NOT NULL,
  counter_offer_amount_paise BIGINT CHECK (counter_offer_amount_paise IS NULL OR counter_offer_amount_paise > 0),
  counter_offer_due_date DATE,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'COUNTER_OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  channel TEXT NOT NULL DEFAULT 'WHATSAPP' CHECK (channel IN ('WHATSAPP', 'EMAIL', 'PHONE', 'IN_PERSON')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_negotiations_business ON payment_negotiations (business_id);

CREATE TRIGGER trg_negotiations_updated_at
  BEFORE UPDATE ON payment_negotiations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS negotiation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID NOT NULL REFERENCES payment_negotiations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('DISTRIBUTOR', 'COUNTERPARTY')),
  sender_name TEXT NOT NULL,
  message_text TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_negotiation_messages ON negotiation_messages (negotiation_id);

-- Communication Logs
CREATE TABLE IF NOT EXISTS communication_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('RETAILER', 'SUPPLIER')),
  recipient_id UUID,
  recipient_name TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'WHATSAPP', 'SMS')),
  subject TEXT,
  message_body TEXT NOT NULL,
  template_key TEXT,
  status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  external_message_id TEXT,
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comm_logs_business ON communication_logs (business_id);

-- Automation Rules & Approval Queue
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  event_trigger TEXT NOT NULL CHECK (event_trigger IN ('INVOICE_OVERDUE', 'PAYMENT_UNMATCHED', 'FORECAST_BREACH', 'COMMITMENT_MISSED')),
  action_type TEXT NOT NULL CHECK (action_type IN ('SEND_REMINDER', 'ALERT_OWNER', 'TRIGGER_AUTOPILOT', 'DRAFT_NEGOTIATION')),
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_automation_rules_updated_at
  BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS automation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES automation_rules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'EXECUTING', 'COMPLETED', 'REJECTED')),
  action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by TEXT,
  decision_notes TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_queue_business ON automation_queue (business_id, status);

