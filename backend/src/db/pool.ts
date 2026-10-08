import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
) {
  return db.query<T>(sql, params);
}

/** Runs fn inside a transaction; commits on success, rolls back on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
