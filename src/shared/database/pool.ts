import { Pool, PoolConfig, QueryResult, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../observability/logger';
import { withSpan } from '../observability/tracer';

const baseConfig: Partial<PoolConfig> = {
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
};

export const primaryPool = new Pool({ connectionString: config.databaseUrl, ...baseConfig, min: 5, max: 25 });
export const replicaPool = config.databaseReplicaUrl
  ? new Pool({ connectionString: config.databaseReplicaUrl, ...baseConfig, min: 3, max: 15 })
  : primaryPool;

primaryPool.on('error', (err) => logger.error({ err }, 'Primary pool error'));
if (config.databaseReplicaUrl) replicaPool.on('error', (err) => logger.error({ err }, 'Replica pool error'));

export async function queryPrimary<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return withSpan('db.query.primary', () => primaryPool.query<T>(sql, params), { 'db.system': 'postgresql', 'db.operation': sql.trimStart().split(' ')[0]?.toUpperCase() ?? 'QUERY' });
}

export async function queryReplica<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return withSpan('db.query.replica', () => replicaPool.query<T>(sql, params), { 'db.system': 'postgresql', 'db.operation': sql.trimStart().split(' ')[0]?.toUpperCase() ?? 'QUERY' });
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await primaryPool.connect();
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
