import type { Pool, PoolClient } from 'pg';
import { createOperationalRepository, type OperationalRepository } from './operational-repository.js';

export type TransactionWork<T> = (repository: OperationalRepository) => Promise<T>;

export function createTransactionRunner(pool: Pool) {
  return async function runInTransaction<T>(work: TransactionWork<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const repository = createOperationalRepository(client as unknown as Pool);
      const result = await work(repository);
      await client.query('commit');
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // Preserve the original transaction error. Connection health is handled by the pool.
  }
}

export type TransactionRunner = ReturnType<typeof createTransactionRunner>;
