import { Pool } from 'pg';

export interface DatabaseHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'axoros-api',
  });
}

export async function checkDatabase(pool: Pool): Promise<DatabaseHealth> {
  const startedAt = performance.now();
  try {
    await pool.query('select 1');
    return {
      ok: true,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
