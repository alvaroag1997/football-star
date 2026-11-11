import { Pool, PoolClient } from 'pg';

// Pool reutilizable entre invocaciones de la misma instancia serverless.
const g = globalThis as unknown as { _pgPool?: Pool };

export const pool: Pool =
  g._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Supabase
    max: 3,
  });
g._pgPool = pool;

/** Ejecuta fn dentro de una transacción. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
