import pg, { type Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getEnv } from '../config/env.js';

// Ensure DATE (OID 1082) stays a calendar ISO string 'YYYY-MM-DD' without local-timezone shift,
// and INT8 / BIGINT (OID 20) stays a decimal string for bigint safety.
pg.types.setTypeParser(1082, (val: string) => val);
pg.types.setTypeParser(20, (val: string) => val);

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const env = getEnv();
  pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: env.PG_SSL ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    console.error('[pg.Pool] Unexpected idle client error:', err);
  });

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: PoolClient,
): Promise<QueryResult<T>> {
  if (client) {
    return client.query<T>(text, params);
  }
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[pg.Pool] Failed to rollback transaction:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface DatabaseHealth {
  ok: boolean;
  databaseName: string;
  serverVersion: string;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const result = await getPool().query<{
    ok: number;
    database_name: string;
    server_version: string;
  }>('SELECT 1 AS ok, current_database() AS database_name, version() AS server_version');

  const row = result.rows[0];
  return {
    ok: row?.ok === 1,
    databaseName: row?.database_name ?? 'unknown',
    serverVersion: row?.server_version ?? 'unknown',
  };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
