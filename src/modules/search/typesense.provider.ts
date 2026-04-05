import TypesenseClient from 'typesense/lib/Typesense/Client';
import type { SearchParams } from 'typesense/lib/Typesense/Documents';
import { config } from '../../shared/config';
import { ISearchProvider, SearchDocument, SearchOptions, SearchResponse } from './search.interface';
import { logger } from '../../shared/observability/logger';

const COLLECTIONS: Record<string, object> = {
  tasks: {
    name: 'tasks',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'org_id', type: 'string', facet: true },
      { name: 'title', type: 'string' },
      { name: 'body', type: 'string', optional: true },
    ],
    default_sorting_field: '',
  },
  chat_messages: {
    name: 'chat_messages',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'org_id', type: 'string', facet: true },
      { name: 'body', type: 'string' },
    ],
    default_sorting_field: '',
  },
  files: {
    name: 'files',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'org_id', type: 'string', facet: true },
      { name: 'filename', type: 'string' },
    ],
    default_sorting_field: '',
  },
  users: {
    name: 'users',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'org_id', type: 'string', facet: true },
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' },
    ],
    default_sorting_field: '',
  },
};

function buildClient(): TypesenseClient {
  const url = new URL(config.typesenseUrl ?? 'http://localhost:8108');
  return new TypesenseClient({
    nodes: [{
      host: url.hostname,
      port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '8108')),
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
    }],
    apiKey: config.typesenseApiKey ?? 'xyz',
    connectionTimeoutSeconds: 5,
  });
}

export class TypesenseProvider implements ISearchProvider {
  private client: InstanceType<typeof TypesenseClient>;
  private initialized = false;

  constructor() {
    this.client = buildClient();
  }

  private async ensureCollections(): Promise<void> {
    if (this.initialized) return;
    for (const schema of Object.values(COLLECTIONS)) {
      try {
        await (this.client.collections() as { create: (s: unknown) => Promise<unknown> }).create(schema);
      } catch {
        // collection already exists — ignore
      }
    }
    this.initialized = true;
  }

  async upsertDocument(doc: SearchDocument): Promise<void> {
    await this.ensureCollections();
    const collectionMap: Record<string, string> = {
      task: 'tasks',
      message: 'chat_messages',
      file: 'files',
      user: 'users',
    };
    const collection = collectionMap[doc.entity_type];
    if (!collection) return;

    const typesenseDoc = {
      id: doc.id,
      org_id: doc.org_id,
      title: doc.title ?? '',
      body: doc.body ?? '',
      filename: (doc.metadata?.['filename'] as string) ?? '',
      name: (doc.metadata?.['name'] as string) ?? '',
      email: (doc.metadata?.['email'] as string) ?? '',
    };

    await this.client.collections(collection).documents().upsert(typesenseDoc);
  }

  async deleteDocument(id: string, _orgId: string): Promise<void> {
    await this.ensureCollections();
    for (const collection of Object.keys(COLLECTIONS)) {
      try {
        await this.client.collections(collection).documents(id).delete();
      } catch {
        // not found in this collection — continue
      }
    }
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    await this.ensureCollections();
    const { query, orgId, entityTypes, limit = 20, offset = 0 } = options;
    const types = entityTypes ?? ['task', 'message', 'file', 'user'];
    const collectionMap: Record<string, string> = {
      task: 'tasks',
      message: 'chat_messages',
      file: 'files',
      user: 'users',
    };

    const results: Array<{ id: string; entity_type: typeof types[number]; score: number }> = [];

    for (const entityType of types) {
      const collection = collectionMap[entityType];
      if (!collection) continue;

      // MANDATORY: every search MUST include filter_by: 'org_id:={orgId}'
      const searchParams: SearchParams = {
        q: query,
        query_by: entityType === 'task' ? 'title,body' :
                  entityType === 'message' ? 'body' :
                  entityType === 'file' ? 'filename' : 'name,email',
        filter_by: `org_id:=${orgId}`,
        per_page: limit,
        page: Math.floor(offset / limit) + 1,
      };

      try {
        const response = await this.client.collections(collection).documents().search(searchParams);
        const hits = (response as { hits?: Array<{ document: { id: string }; text_match: number }> }).hits ?? [];
        for (const hit of hits) {
          results.push({
            id: hit.document.id,
            entity_type: entityType as typeof types[number],
            score: hit.text_match,
          });
        }
      } catch (err) {
        logger.warn({ err, collection, orgId }, 'TypesenseProvider: search error');
      }
    }

    return {
      results,
      total: results.length,
    };
  }

  async reindexAll(_orgId: string): Promise<void> {
    logger.info({ _orgId }, 'TypesenseProvider: reindexAll — use search worker for incremental reindex');
  }
}
