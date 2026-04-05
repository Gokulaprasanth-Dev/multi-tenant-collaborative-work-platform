import { config } from '../../shared/config';
import { searchBreaker } from '../../shared/circuit-breaker';
import { logger } from '../../shared/observability/logger';
import { PostgresFtsProvider } from './postgres-fts.provider';
import { TypesenseProvider } from './typesense.provider';
import { ISearchProvider, SearchOptions, SearchResponse } from './search.interface';

let pgsFtsProvider: PostgresFtsProvider | null = null;
let activeProvider: ISearchProvider | null = null;

function getPgsFtsProvider(): PostgresFtsProvider {
  if (!pgsFtsProvider) pgsFtsProvider = new PostgresFtsProvider();
  return pgsFtsProvider;
}

function getActiveProvider(): ISearchProvider {
  if (!activeProvider) {
    if (config.searchProvider === 'typesense') {
      activeProvider = new TypesenseProvider();
    } else {
      activeProvider = getPgsFtsProvider();
    }
  }
  return activeProvider;
}

export async function search(options: SearchOptions): Promise<SearchResponse> {
  const provider = getActiveProvider();

  try {
    const result = await searchBreaker.fire(async () => provider.search(options)) as SearchResponse;
    return result;
  } catch (err) {
    // Breaker open or provider error — fall back to PostgresFTS
    logger.warn({ err }, 'searchService: provider error, falling back to PostgresFTS');
    const fallbackResult = await getPgsFtsProvider().search(options);
    return { ...fallbackResult, degraded: true };
  }
}
