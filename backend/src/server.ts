import { getEnv } from './config/env.js';
import { checkDatabaseHealth, closePool } from './db/pool.js';
import { createApp } from './app.js';

async function startServer(): Promise<void> {
  const env = getEnv();
  const dbHealth = await checkDatabaseHealth();
  if (!dbHealth.ok) {
    throw new Error('PostgreSQL startup health check failed.');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(
      `[FlowBridge API] Listening on http://localhost:${env.PORT} (PostgreSQL DB: ${dbHealth.databaseName})`,
    );
  });

  const shutdown = async () => {
    console.log('[FlowBridge API] Shutting down...');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch(async (err) => {
  console.error('[FlowBridge API] Startup failed:', err);
  await closePool().catch(() => undefined);
  process.exit(1);
});

