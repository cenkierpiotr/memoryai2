import { config } from '../config.js';
import { logger } from '../utils/logger.js';

interface RerankResult {
  index: number;
  relevance_score: number;
}

export async function rerank(query: string, documents: string[]): Promise<number[]> {
  if (!config.reranker.enabled || documents.length === 0) {
    return documents.map((_, i) => i);
  }

  try {
    const res = await fetch(`${config.reranker.ollamaBaseUrl}/api/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.reranker.model,
        query,
        documents,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Reranker failed: ${res.status}`);

    const data = await res.json() as { results: RerankResult[] };
    return data.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map(r => r.index);
  } catch (err) {
    // Reranker is best-effort — fall back to original order on failure
    logger.warn('reranker', `Unavailable, using original ranking: ${err}`);
    return documents.map((_, i) => i);
  }
}
