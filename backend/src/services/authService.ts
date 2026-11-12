import type { PoolClient } from 'pg';
import { getPool, withTransaction } from '../db/pool.js';
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../utils/passwords.js';

export interface UserDTO {
  id: string;
  businessId: string;
  email: string;
  fullName: string;
  role: 'OWNER' | 'FINANCE_MANAGER' | 'STAFF';
  languagePreference: 'en' | 'hi' | 'ta';
  businessName: string;
  businessCode: string;
}

export interface AuthSessionResult {
  token: string;
  user: UserDTO;
  expiresAt: string;
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function registerUser(input: {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
  languagePreference?: 'en' | 'hi' | 'ta';
}): Promise<AuthSessionResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || !input.fullName.trim() || !input.businessName.trim()) {
    throw new Error('All registration fields are required');
  }

  return withTransaction(async (client) => {
    // Check if email already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Create business
    const code = `BIZ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
    const today = new Date().toISOString().slice(0, 10);
    const bizRes = await client.query<{ id: string; name: string; code: string }>(
      `INSERT INTO businesses (
        code, name, currency, timezone, opening_cash_paise, opening_cash_date, minimum_cash_paise
      ) VALUES ($1, $2, 'INR', 'Asia/Kolkata', 8000000, $3, 1000000)
      RETURNING id, name, code`,
      [code, input.businessName.trim(), today],
    );
    const business = bizRes.rows[0];

    // Create user
    const passwordHash = hashPassword(input.password);
    const lang = input.languagePreference ?? 'en';
    const userRes = await client.query<{ id: string; full_name: string; role: string; language_preference: string }>(
      `INSERT INTO users (
        business_id, email, password_hash, full_name, role, language_preference
      ) VALUES ($1, $2, $3, $4, 'OWNER', $5)
      RETURNING id, full_name, role, language_preference`,
      [business.id, email, passwordHash, input.fullName.trim(), lang],
    );
    const userRow = userRes.rows[0];

    // Initialize default emergency reserve for the business
    await client.query(
      `INSERT INTO reserve_allocations (
        business_id, target_reserve_paise, current_reserve_paise, minimum_threshold_paise, status
      ) VALUES ($1, 5000000, 5000000, 1500000, 'ACTIVE')
      ON CONFLICT (business_id) DO NOTHING`,
      [business.id],
    );

    // Create session
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    await client.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userRow.id, tokenHash, expiresAt],
    );

    const user: UserDTO = {
      id: userRow.id,
      businessId: business.id,
      email,
      fullName: userRow.full_name,
      role: userRow.role as UserDTO['role'],
      languagePreference: userRow.language_preference as UserDTO['languagePreference'],
      businessName: business.name,
      businessCode: business.code,
    };

    return { token: rawToken, user, expiresAt };
  });
}

export async function loginUser(input: { email: string; password: string }): Promise<AuthSessionResult> {
  const email = input.email.trim().toLowerCase();
  const pool = getPool();

  const userRes = await pool.query<{
    id: string;
    business_id: string;
    email: string;
    password_hash: string;
    full_name: string;
    role: string;
    language_preference: string;
    business_name: string;
    business_code: string;
  }>(
    `SELECT u.id, u.business_id, u.email, u.password_hash, u.full_name, u.role, u.language_preference,
            b.name AS business_name, b.code AS business_code
     FROM users u
     JOIN businesses b ON b.id = u.business_id
     WHERE u.email = $1`,
    [email],
  );

  if (userRes.rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const row = userRes.rows[0];
  const isValid = verifyPassword(input.password, row.password_hash);
  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [row.id, tokenHash, expiresAt],
  );

  const user: UserDTO = {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as UserDTO['role'],
    languagePreference: row.language_preference as UserDTO['languagePreference'],
    businessName: row.business_name,
    businessCode: row.business_code,
  };

  return { token: rawToken, user, expiresAt };
}

export async function getUserBySessionToken(rawToken: string): Promise<UserDTO | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = hashSessionToken(rawToken);
  const pool = getPool();

  const res = await pool.query<{
    id: string;
    business_id: string;
    email: string;
    full_name: string;
    role: string;
    language_preference: string;
    business_name: string;
    business_code: string;
  }>(
    `SELECT u.id, u.business_id, u.email, u.full_name, u.role, u.language_preference,
            b.name AS business_name, b.code AS business_code
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN businesses b ON b.id = u.business_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  );

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  return {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as UserDTO['role'],
    languagePreference: row.language_preference as UserDTO['languagePreference'],
    businessName: row.business_name,
    businessCode: row.business_code,
  };
}

export async function invalidateSession(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashSessionToken(rawToken);
  const pool = getPool();
  await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
}

export async function updateUserLanguagePreference(userId: string, lang: 'en' | 'hi' | 'ta'): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE users SET language_preference = $1, updated_at = now() WHERE id = $2', [lang, userId]);
}

/**
 * Ensures demo user exists for the seeded demo business.
 */
export async function ensureDemoUser(businessId: string): Promise<void> {
  const pool = getPool();
  const demoEmail = 'owner@flowbridge.local';
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [demoEmail]);
  if (existing.rows.length > 0) return;

  const passwordHash = hashPassword('FlowBridge123!');
  await pool.query(
    `INSERT INTO users (business_id, email, password_hash, full_name, role, language_preference)
     VALUES ($1, $2, $3, 'Demo Distributor Owner', 'OWNER', 'en')`,
    [businessId, demoEmail, passwordHash],
  );

  // Also ensure demo emergency reserve
  await pool.query(
    `INSERT INTO reserve_allocations (
      business_id, target_reserve_paise, current_reserve_paise, minimum_threshold_paise, status
    ) VALUES ($1, 5000000, 5000000, 1500000, 'ACTIVE')
    ON CONFLICT (business_id) DO NOTHING`,
    [businessId],
  );
}

