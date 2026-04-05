export interface SearchDocument {
  id: string;
  org_id: string;
  entity_type: 'task' | 'message' | 'file' | 'user';
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  entity_type: 'task' | 'message' | 'file' | 'user';
  score: number;
  highlight?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  orgId: string;
  entityTypes?: Array<'task' | 'message' | 'file' | 'user'>;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  nextCursor?: string;
  degraded?: boolean;
}

export interface ISearchProvider {
  upsertDocument(doc: SearchDocument): Promise<void>;
  deleteDocument(id: string, orgId: string): Promise<void>;
  search(options: SearchOptions): Promise<SearchResponse>;
  reindexAll(orgId: string): Promise<void>;
}
