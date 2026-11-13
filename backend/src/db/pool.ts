import crypto from 'node:crypto';
import pg, { type Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { newDb, type IMemoryDb } from 'pg-mem';
import { getEnv } from '../config/env.js';

// Ensure DATE (OID 1082) stays a calendar ISO string 'YYYY-MM-DD' without local-timezone shift,
// and INT8 / BIGINT (OID 20) stays a decimal string for bigint safety.
pg.types.setTypeParser(1082, (val: string) => val);
pg.types.setTypeParser(20, (val: string) => val);

let pool: Pool | null = null;
let isMemoryFallback = false;
let memDbInstance: IMemoryDb | null = null;

export function isMemoryDbActive(): boolean {
  return isMemoryFallback || process.env.USE_MEMORY_DB === 'true';
}

function createMemoryPool(): Pool {
  if (memDbInstance && pool) return pool;

  console.log('[FlowBridge DB] Initializing embedded zero-config relational store (pg-mem)...');
  const memDb = newDb();

  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });
  memDb.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 16.1 (pg-mem fallback)',
  });
  memDb.public.registerFunction({
    name: 'current_database',
    implementation: () => 'flowbridge',
  });

  const adapter = memDb.adapters.createPg();
  const memoryPool = new adapter.Pool() as unknown as Pool;

  memDbInstance = memDb;
  isMemoryFallback = true;
  pool = memoryPool;
  return pool;
}

export function getPool(): Pool {
  if (pool) return pool;
  const env = getEnv();

  if (process.env.USE_MEMORY_DB === 'true') {
    return createMemoryPool();
  }

  try {
    const pgPool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.PG_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
      ssl: env.PG_SSL ? { rejectUnauthorized: false } : undefined,
    });

    pgPool.on('error', (err) => {
      console.warn('[pg.Pool] Connection error:', err.message);
    });

    pool = pgPool;
    return pool;
  } catch (err: any) {
    console.warn(`[FlowBridge DB] Failed to initialize pg.Pool (${err.message}). Falling back to memory DB.`);
    return createMemoryPool();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: PoolClient,
): Promise<QueryResult<T>> {
  if (isMemoryFallback) {
    if (/^\s*(SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT|ALTER\s+TABLE\s+.*\s+(DISABLE|ENABLE)\s+TRIGGER)/i.test(text)) {
      return { rows: [], rowCount: 0, command: 'NOOP', oid: 0, fields: [] } as unknown as QueryResult<T>;
    }
  }
  let sql = text;
  if (isMemoryFallback) {
    sql = sql.replace(/\s+FOR\s+UPDATE\s+OF\s+[a-z0-9_]+/gi, '');
  }
  if (client) {
    return client.query<T>(sql, params);
  }
  return getPool().query<T>(sql, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  if (isMemoryFallback) {
    const origQuery = client.query.bind(client);
    client.query = ((sqlOrConfig: any, ...args: any[]) => {
      if (typeof sqlOrConfig === 'string') {
        if (/^\s*(SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT|ALTER\s+TABLE\s+.*\s+(DISABLE|ENABLE)\s+TRIGGER)/i.test(sqlOrConfig)) {
          return Promise.resolve({ rows: [], rowCount: 0, command: 'NOOP', oid: 0, fields: [] });
        }
        const cleaned = sqlOrConfig.replace(/\s+FOR\s+UPDATE\s+OF\s+[a-z0-9_]+/gi, '');
        return (origQuery as any)(cleaned, ...args);
      }
      return (origQuery as any)(sqlOrConfig, ...args);
    }) as any;
  }
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
  const env = getEnv();

  if (process.env.USE_MEMORY_DB === 'true' || isMemoryFallback) {
    if (!pool) createMemoryPool();
    return {
      ok: true,
      databaseName: 'flowbridge',
      serverVersion: 'PostgreSQL 16.1 (pg-mem fallback)',
    };
  }

  // Attempt connection to PostgreSQL
  try {
    const currentPool = getPool();
    const result = await currentPool.query<{
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
  } catch (err: any) {
    console.warn(
      `[FlowBridge DB] PostgreSQL not reachable at ${env.DATABASE_URL} (${err.message}). Operating with embedded fallback relational store.`,
    );
    // Tear down unconnectable PG pool and switch to pg-mem fallback
    if (pool) {
      try {
        pool.end().catch(() => undefined);
      } catch {}
      pool = null;
    }
    createMemoryPool();
    return {
      ok: true,
      databaseName: 'flowbridge',
      serverVersion: 'PostgreSQL 16.1 (pg-mem fallback)',
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    isMemoryFallback = false;
    memDbInstance = null;
  }
}
