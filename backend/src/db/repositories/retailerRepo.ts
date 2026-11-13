import type { PoolClient } from 'pg';
import type { IdentifierType, RetailerDTO, RetailerPaymentIdentifierDTO } from '@flowbridge/shared';
import { query } from '../pool.js';

interface RetailerRow {
  id: string;
  business_id: string;
  retailer_code: string;
  name: string;
  contact_name: string | null;
  phone_masked: string | null;
  contact_phone?: string | null;
  email: string | null;
  credit_terms_days: number;
  reliability_score: number;
  unapplied_credit_paise: string;
  status: 'ACTIVE' | 'HOLD' | 'INACTIVE';
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface IdentifierRow {
  id: string;
  business_id: string;
  retailer_id: string;
  identifier_type: IdentifierType;
  normalized_fingerprint: string;
  masked_value: string;
  display_label: string;
  verified_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface VerifiedIdentifierWithRetailer {
  identifierId: string;
  retailerId: string;
  retailerCode: string;
  retailerName: string;
  identifierType: IdentifierType;
  maskedValue: string;
}

function mapRetailer(row: RetailerRow): RetailerDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    retailerCode: row.retailer_code,
    name: row.name,
    contactName: row.contact_name,
    phoneMasked: row.phone_masked,
    contactPhone: row.contact_phone ?? row.phone_masked ?? null,
    email: row.email,
    creditTermsDays: row.credit_terms_days,
    reliabilityScore: row.reliability_score,
    unappliedCreditPaise: String(row.unapplied_credit_paise),
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapIdentifier(row: IdentifierRow): RetailerPaymentIdentifierDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    retailerId: row.retailer_id,
    identifierType: row.identifier_type,
    maskedValue: row.masked_value,
    displayLabel: row.display_label,
    verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listRetailers(businessId: string, client?: PoolClient): Promise<RetailerDTO[]> {
  const res = await query<RetailerRow>(
    'SELECT * FROM retailers WHERE business_id = $1 ORDER BY retailer_code ASC',
    [businessId],
    client,
  );
  return res.rows.map(mapRetailer);
}

export async function getRetailerById(
  businessId: string,
  retailerId: string,
  client?: PoolClient,
): Promise<RetailerDTO | null> {
  const res = await query<RetailerRow>(
    'SELECT * FROM retailers WHERE id = $1 AND business_id = $2',
    [retailerId, businessId],
    client,
  );
  return res.rows[0] ? mapRetailer(res.rows[0]) : null;
}

export async function createRetailer(
  input: {
    businessId: string;
    retailerCode: string;
    name: string;
    contactName?: string | null;
    phoneMasked?: string | null;
    contactPhone?: string | null;
    email?: string | null;
    creditTermsDays?: number;
    reliabilityScore?: number;
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<RetailerDTO> {
  const phone = input.contactPhone ?? input.phoneMasked ?? null;
  const res = await query<RetailerRow>(
    `INSERT INTO retailers (
      business_id, retailer_code, name, contact_name, phone_masked, contact_phone, email,
      credit_terms_days, reliability_score, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.businessId,
      input.retailerCode,
      input.name,
      input.contactName ?? null,
      input.phoneMasked ?? phone,
      phone,
      input.email ?? null,
      input.creditTermsDays ?? 30,
      input.reliabilityScore ?? 80,
      input.notes ?? null,
    ],
    client,
  );
  return mapRetailer(res.rows[0]);
}

export async function listPaymentIdentifiers(
  businessId: string,
  retailerId?: string,
  client?: PoolClient,
): Promise<RetailerPaymentIdentifierDTO[]> {
  if (retailerId) {
    const res = await query<IdentifierRow>(
      `SELECT * FROM retailer_payment_identifiers
        WHERE business_id = $1 AND retailer_id = $2
        ORDER BY created_at DESC`,
      [businessId, retailerId],
      client,
    );
    return res.rows.map(mapIdentifier);
  }
  const res = await query<IdentifierRow>(
    `SELECT * FROM retailer_payment_identifiers
      WHERE business_id = $1
      ORDER BY created_at DESC`,
    [businessId],
    client,
  );
  return res.rows.map(mapIdentifier);
}

export async function registerPaymentIdentifier(
  input: {
    businessId: string;
    retailerId: string;
    identifierType: IdentifierType;
    normalizedFingerprint: string;
    maskedValue: string;
    displayLabel: string;
    verified?: boolean;
  },
  client?: PoolClient,
): Promise<RetailerPaymentIdentifierDTO> {
  const res = await query<IdentifierRow>(
    `INSERT INTO retailer_payment_identifiers (
      business_id, retailer_id, identifier_type, normalized_fingerprint,
      masked_value, display_label, verified_at, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
    RETURNING *`,
    [
      input.businessId,
      input.retailerId,
      input.identifierType,
      input.normalizedFingerprint,
      input.maskedValue,
      input.displayLabel,
      input.verified === false ? null : new Date().toISOString(),
    ],
    client,
  );
  return mapIdentifier(res.rows[0]);
}

export async function updateRetailer(
  businessId: string,
  retailerId: string,
  patch: {
    name?: string;
    contactName?: string | null;
    phoneMasked?: string | null;
    contactPhone?: string | null;
    email?: string | null;
    creditTermsDays?: number;
    reliabilityScore?: number;
    status?: 'ACTIVE' | 'HOLD' | 'INACTIVE';
    notes?: string | null;
  },
  client?: PoolClient,
): Promise<RetailerDTO | null> {
  const existing = await getRetailerById(businessId, retailerId, client);
  if (!existing) return null;
  const newPhone = patch.contactPhone !== undefined ? patch.contactPhone : existing.contactPhone;
  const res = await query<RetailerRow>(
    `UPDATE retailers
        SET name = $3,
            contact_name = $4,
            phone_masked = $5,
            contact_phone = $6,
            email = $7,
            credit_terms_days = $8,
            reliability_score = $9,
            status = $10,
            notes = $11
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
    [
      retailerId,
      businessId,
      patch.name ?? existing.name,
      patch.contactName !== undefined ? patch.contactName : existing.contactName,
      patch.phoneMasked !== undefined ? patch.phoneMasked : existing.phoneMasked,
      newPhone,
      patch.email !== undefined ? patch.email : existing.email,
      patch.creditTermsDays ?? existing.creditTermsDays,
      patch.reliabilityScore ?? existing.reliabilityScore,
      patch.status ?? existing.status,
      patch.notes !== undefined ? patch.notes : existing.notes,
    ],
    client,
  );
  return res.rows[0] ? mapRetailer(res.rows[0]) : null;
}

export async function updatePaymentIdentifier(
  businessId: string,
  retailerId: string,
  identifierId: string,
  patch: {
    isActive?: boolean;
    verified?: boolean;
    displayLabel?: string;
  },
  client?: PoolClient,
): Promise<RetailerPaymentIdentifierDTO | null> {
  const existing = await query<IdentifierRow>(
    `SELECT * FROM retailer_payment_identifiers
      WHERE id = $1 AND business_id = $2 AND retailer_id = $3`,
    [identifierId, businessId, retailerId],
    client,
  );
  if (existing.rows.length === 0) return null;
  const cur = existing.rows[0];
  const nextVerifiedAt =
    patch.verified === undefined
      ? cur.verified_at
      : patch.verified
        ? cur.verified_at ?? new Date()
        : null;

  const res = await query<IdentifierRow>(
    `UPDATE retailer_payment_identifiers
        SET is_active = $4,
            verified_at = $5,
            display_label = $6
      WHERE id = $1 AND business_id = $2 AND retailer_id = $3
      RETURNING *`,
    [
      identifierId,
      businessId,
      retailerId,
      patch.isActive ?? cur.is_active,
      nextVerifiedAt,
      patch.displayLabel ?? cur.display_label,
    ],
    client,
  );
  return res.rows[0] ? mapIdentifier(res.rows[0]) : null;
}

export async function deactivatePaymentIdentifier(
  businessId: string,
  identifierId: string,
  client?: PoolClient,
): Promise<boolean> {
  const res = await query(
    `UPDATE retailer_payment_identifiers
        SET is_active = false
      WHERE id = $1 AND business_id = $2`,
    [identifierId, businessId],
    client,
  );
  return (res.rowCount ?? 0) > 0;
}

export async function findVerifiedRetailersByFingerprint(
  businessId: string,
  fingerprint: string,
  client?: PoolClient,
): Promise<VerifiedIdentifierWithRetailer[]> {
  const res = await query<{
    identifier_id: string;
    retailer_id: string;
    retailer_code: string;
    retailer_name: string;
    identifier_type: IdentifierType;
    masked_value: string;
  }>(
    `SELECT rpi.id AS identifier_id,
            r.id AS retailer_id,
            r.retailer_code,
            r.name AS retailer_name,
            rpi.identifier_type,
            rpi.masked_value
       FROM retailer_payment_identifiers rpi
       JOIN retailers r ON r.id = rpi.retailer_id AND r.business_id = rpi.business_id
      WHERE rpi.business_id = $1
        AND rpi.normalized_fingerprint = $2
        AND rpi.is_active = true
        AND rpi.verified_at IS NOT NULL
        AND r.status <> 'INACTIVE'`,
    [businessId, fingerprint],
    client,
  );

  return res.rows.map((row) => ({
    identifierId: row.identifier_id,
    retailerId: row.retailer_id,
    retailerCode: row.retailer_code,
    retailerName: row.retailer_name,
    identifierType: row.identifier_type,
    maskedValue: row.masked_value,
  }));
}

