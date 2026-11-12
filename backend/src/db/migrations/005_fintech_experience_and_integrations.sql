-- 005_fintech_experience_and_integrations.sql
-- Upgrades FlowBridge schema with:
-- 1. Real Distributor Profile & Contact Details (Owner, WhatsApp, Address, Email & WhatsApp configs, Connected Android devices)
-- 2. Bank SMS Ingestion Evidence (HDFC, ICICI, SBI, Axis, Kotak parse tracking and reconciliation)
-- 3. Email Delivery & Outbound Dispatch Queue

-- 1. Extend businesses table with contact, profile, and integration settings
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'FMCG_DISTRIBUTOR',
  ADD COLUMN IF NOT EXISTS warehouse_address TEXT,
  ADD COLUMN IF NOT EXISTS email_configurations JSONB NOT NULL DEFAULT '{
    "provider": "SMTP",
    "configured": false,
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUser": "",
    "fromEmail": "billing@flowbridge.local",
    "fromName": "FlowBridge Billing"
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_configurations JSONB NOT NULL DEFAULT '{
    "mode": "WEB_HAIL",
    "phoneNumberId": "",
    "accessToken": "",
    "webhookSecret": "",
    "isConfigured": false
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS connected_devices JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Bank SMS transaction evidence table
CREATE TABLE IF NOT EXISTS transaction_sms_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sender_header TEXT NOT NULL,
  raw_sms_body TEXT NOT NULL,
  parsed_amount_paise BIGINT,
  parsed_reference_number TEXT,
  parsed_counterparty_hint TEXT,
  parsed_transaction_date DATE,
  parsed_account_tail TEXT,
  matched_payment_id UUID REFERENCES payment_transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PARSED' CHECK (status IN ('PARSED', 'MATCHED', 'DISMISSED')),
  confidence_score INTEGER NOT NULL DEFAULT 85 CHECK (confidence_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_evidence_business ON transaction_sms_evidence (business_id, status);
CREATE INDEX IF NOT EXISTS idx_sms_evidence_ref ON transaction_sms_evidence (parsed_reference_number);

-- 3. Email Delivery Queue
CREATE TABLE IF NOT EXISTS email_delivery_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  pdf_filename TEXT,
  pdf_content_base64 TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_delivery_queue (business_id, status);
