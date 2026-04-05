import { queryPrimary, queryReplica } from '../../shared/database/pool';
import { ISearchProvider, SearchDocument, SearchOptions, SearchResponse, SearchResult } from './search.interface';
import { logger } from '../../shared/observability/logger';

export class PostgresFtsProvider implements ISearchProvider {
  async upsertDocument(_doc: SearchDocument): Promise<void> {
    // search_vector is a GENERATED ALWAYS AS STORED column on tasks and chat_messages —
    // it is automatically updated by PostgreSQL when title/body changes.
    // Files and users are indexed via ILIKE; no tsvector column exists.
    // Therefore no manual update is required here.
  }

  async deleteDocument(_id: string, _orgId: string): Promise<void> {
    // PostgreSQL FTS does not maintain a separate index — deletion handled by row deletion
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const { query, orgId, entityTypes, limit = 20, offset = 0 } = options;
    const types = entityTypes ?? ['task', 'message', 'file', 'user'];
    const results: SearchResult[] = [];

    if (types.includes('task')) {
      const rows = await queryReplica<{ id: string; title: string; rank: number }>(
        `SELECT id, title, ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM tasks
         WHERE org_id = $2 AND deleted_at IS NULL AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $3 OFFSET $4`,
        [query, orgId, limit, offset]
      );
      for (const row of rows.rows) {
        results.push({ id: row.id, entity_type: 'task', score: row.rank, metadata: { title: row.title } });
      }
    }

    if (types.includes('message')) {
      const rows = await queryReplica<{ id: string; body: string; rank: number }>(
        `SELECT id, body, ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM chat_messages
         WHERE org_id = $2 AND deleted_at IS NULL AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $3 OFFSET $4`,
        [query, orgId, limit, offset]
      );
      for (const row of rows.rows) {
        results.push({ id: row.id, entity_type: 'message', score: row.rank });
      }
    }

    if (types.includes('file')) {
      const rows = await queryReplica<{ id: string; filename: string }>(
        `SELECT id, filename FROM files
         WHERE org_id = $1 AND deleted_at IS NULL AND filename ILIKE $2
         LIMIT $3 OFFSET $4`,
        [orgId, `%${query}%`, limit, offset]
      );
      for (const row of rows.rows) {
        results.push({ id: row.id, entity_type: 'file', score: 1, metadata: { filename: row.filename } });
      }
    }

    if (types.includes('user')) {
      const rows = await queryReplica<{ id: string; name: string; email: string }>(
        `SELECT u.id, u.name, u.email FROM users u
         JOIN org_memberships om ON om.user_id = u.id AND om.org_id = $1 AND om.status = 'active' AND om.deleted_at IS NULL
         WHERE (u.name ILIKE $2 OR u.email ILIKE $2)
         LIMIT $3 OFFSET $4`,
        [orgId, `%${query}%`, limit, offset]
      );
      for (const row of rows.rows) {
        results.push({ id: row.id, entity_type: 'user', score: 1, metadata: { name: row.name, email: row.email } });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return {
      results: results.slice(0, limit),
      total: results.length,
    };
  }

  async reindexAll(orgId: string): Promise<void> {
    await queryPrimary(
      `UPDATE tasks SET updated_at = NOW()
       WHERE org_id = $1 AND deleted_at IS NULL`,
      [orgId]
    );
    // search_vector on chat_messages is GENERATED ALWAYS AS STORED — trigger regeneration
    // by touching the source column (body), not by setting search_vector directly.
    await queryPrimary(
      `UPDATE chat_messages SET body = body
       WHERE org_id = $1 AND deleted_at IS NULL`,
      [orgId]
    );
    logger.info({ orgId }, 'PostgresFtsProvider: reindex complete');
  }
}
