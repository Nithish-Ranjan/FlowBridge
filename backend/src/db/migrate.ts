import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDatabaseHealth, closePool, getPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.resolve(__dirname, '../../src/db/migrations'),
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(process.cwd(), 'backend/src/db/migrations'),
  ];
  return candidates.find((dir) => fsSync.existsSync(dir)) || path.join(__dirname, 'migrations');
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const health = await checkDatabaseHealth();
  if (!health.ok) {
    throw new Error('PostgreSQL startup health check failed.');
  }
  const pool = getPool();
  const MIGRATIONS_DIR = getMigrationsDir();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const existing = await pool.query<{ version: string; checksum_sha256: string }>(
    'SELECT version, checksum_sha256 FROM schema_migrations',
  );
  const existingMap = new Map(existing.rows.map((r) => [r.version, r.checksum_sha256]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const filename of sqlFiles) {
    const version = filename.replace(/\.sql$/, '');
    const fullPath = path.join(MIGRATIONS_DIR, filename);
    const sql = await fs.readFile(fullPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');

    const prevChecksum = existingMap.get(version);
    if (prevChecksum) {
      if (prevChecksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${filename}. Already applied migrations must not be edited.`,
        );
      }
      skipped.push(filename);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let executableSql = sql;
      if (health.serverVersion.includes('pg-mem')) {
        executableSql = sql
          .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?LANGUAGE plpgsql;/gi, '')
          .replace(/CREATE TRIGGER[\s\S]*?;/gi, '');
      }
      await client.query(executableSql);
      await client.query(
        'INSERT INTO schema_migrations (version, filename, checksum_sha256) VALUES ($1, $2, $3)',
        [version, filename, checksum],
      );
      await client.query('COMMIT');
      applied.push(filename);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isCli) {
  runMigrations()
    .then((res) => {
      console.log(
        `[db:migrate] Complete. Applied: [${res.applied.join(', ') || 'none'}], Skipped: [${res.skipped.join(', ') || 'none'}]`,
      );
      return closePool();
    })
    .catch(async (err) => {
      console.error('[db:migrate] Error:', err);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}

