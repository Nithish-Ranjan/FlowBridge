-- Migration 005: Add contact_phone to retailers and suppliers, and enhance communication_logs for human-controlled WhatsApp sending
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_phone TEXT;

ALTER TABLE communication_logs ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE communication_logs ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Update status check constraint on communication_logs to include DRAFT, OPENED_IN_WHATSAPP, USER_CONFIRMED_SENT
ALTER TABLE communication_logs DROP CONSTRAINT IF EXISTS communication_logs_status_check;
ALTER TABLE communication_logs ADD CONSTRAINT communication_logs_status_check
  CHECK (status IN ('QUEUED', 'DRAFT', 'OPENED_IN_WHATSAPP', 'USER_CONFIRMED_SENT', 'SENT', 'DELIVERED', 'READ', 'FAILED'));

