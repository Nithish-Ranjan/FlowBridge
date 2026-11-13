import type { PoolClient } from 'pg';
import type { ApprovalLimits, BusinessDTO, SupplierDTO } from '@flowbridge/shared';
import { query } from '../pool.js';

interface BusinessRow {
  id: string;
  code: string;
  name: string;
  currency: 'INR';
  timezone: string;
  opening_cash_paise: string;
  opening_cash_date: string;
  minimum_cash_paise: string;
  allocation_policy: BusinessDTO['allocationPolicy'];
  approval_limits_json: ApprovalLimits;
  created_at: Date;
  updated_at: Date;
}

interface SupplierRow {
  id: string;
  business_id: string;
  supplier_code: string;
  name: string;
  contact_name: string | null;
  phone_masked: string | null;
  email: string | null;
  max_deferral_days: number;
  max_deferral_pct: number;
  is_critical: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
}

function mapBusiness(row: BusinessRow): BusinessDTO {
  const openingDateStr =
    (row.opening_cash_date as unknown) instanceof Date
      ? (row.opening_cash_date as unknown as Date).toISOString().slice(0, 10)
      : String(row.opening_cash_date);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    timezone: row.timezone,
    openingCashPaise: String(row.opening_cash_paise),
    openingCashDate: openingDateStr,
    minimumCashPaise: String(row.minimum_cash_paise),
    allocationPolicy: row.allocation_policy,
    approvalLimits: row.approval_limits_json,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSupplier(row: SupplierRow): SupplierDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    supplierCode: row.supplier_code,
    name: row.name,
    contactName: row.contact_name,
    phoneMasked: row.phone_masked,
    email: row.email,
    maxDeferralDays: row.max_deferral_days,
    maxDeferralPct: row.max_deferral_pct,
    isCritical: row.is_critical,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBusinesses(client?: PoolClient): Promise<BusinessDTO[]> {
  const res = await query<BusinessRow>('SELECT * FROM businesses ORDER BY created_at ASC', [], client);
  return res.rows.map(mapBusiness);
}

export async function getBusinessById(id: string, client?: PoolClient): Promise<BusinessDTO | null> {
  const res = await query<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [id], client);
  return res.rows[0] ? mapBusiness(res.rows[0]) : null;
}

export async function createBusiness(
  input: {
    code: string;
    name: string;
    openingCashPaise: string;
    openingCashDate: string;
    minimumCashPaise: string;
    allocationPolicy: BusinessDTO['allocationPolicy'];
    approvalLimits?: Partial<ApprovalLimits>;
  },
  client?: PoolClient,
): Promise<BusinessDTO> {
  const defaultLimits: ApprovalLimits = {
    maxEarlyRequestPct: 100,
    maxEarlyDays: 14,
    defaultMaxSupplierDeferralPct: 40,
    defaultMaxSupplierDeferralDays: 10,
    protectEssentialExpenses: true,
    maxActionsPerPlan: 2,
    ...input.approvalLimits,
  };
  const res = await query<BusinessRow>(
    `INSERT INTO businesses (
      code, name, opening_cash_paise, opening_cash_date, minimum_cash_paise, allocation_policy, approval_limits_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    RETURNING *`,
    [
      input.code,
      input.name,
      input.openingCashPaise,
      input.openingCashDate,
      input.minimumCashPaise,
      input.allocationPolicy,
      JSON.stringify(defaultLimits),
    ],
    client,
  );
  return mapBusiness(res.rows[0]);
}

export async function updateBusinessSettings(
  id: string,
  patch: {
    openingCashPaise?: string;
    openingCashDate?: string;
    minimumCashPaise?: string;
    allocationPolicy?: BusinessDTO['allocationPolicy'];
    approvalLimits?: ApprovalLimits;
  },
  client?: PoolClient,
): Promise<BusinessDTO | null> {
  const current = await getBusinessById(id, client);
  if (!current) return null;

  const res = await query<BusinessRow>(
    `UPDATE businesses
        SET opening_cash_paise = $2,
            opening_cash_date = $3,
            minimum_cash_paise = $4,
            allocation_policy = $5,
            approval_limits_json = $6::jsonb
      WHERE id = $1
      RETURNING *`,
    [
      id,
      patch.openingCashPaise ?? current.openingCashPaise,
      patch.openingCashDate ?? current.openingCashDate,
      patch.minimumCashPaise ?? current.minimumCashPaise,
      patch.allocationPolicy ?? current.allocationPolicy,
      JSON.stringify(patch.approvalLimits ?? current.approvalLimits),
    ],
    client,
  );
  return res.rows[0] ? mapBusiness(res.rows[0]) : null;
}

export async function listSuppliers(businessId: string, client?: PoolClient): Promise<SupplierDTO[]> {
  const res = await query<SupplierRow>(
    'SELECT * FROM suppliers WHERE business_id = $1 ORDER BY supplier_code ASC',
    [businessId],
    client,
  );
  return res.rows.map(mapSupplier);
}

export async function createSupplier(
  input: {
    businessId: string;
    supplierCode: string;
    name: string;
    contactName?: string | null;
    phoneMasked?: string | null;
    email?: string | null;
    maxDeferralDays?: number;
    maxDeferralPct?: number;
    isCritical?: boolean;
  },
  client?: PoolClient,
): Promise<SupplierDTO> {
  const res = await query<SupplierRow>(
    `INSERT INTO suppliers (
      business_id, supplier_code, name, contact_name, phone_masked, email,
      max_deferral_days, max_deferral_pct, is_critical
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.businessId,
      input.supplierCode,
      input.name,
      input.contactName ?? null,
      input.phoneMasked ?? null,
      input.email ?? null,
      input.maxDeferralDays ?? 7,
      input.maxDeferralPct ?? 30,
      input.isCritical ?? false,
    ],
    client,
  );
  return mapSupplier(res.rows[0]);
}

