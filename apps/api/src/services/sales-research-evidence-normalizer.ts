import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';

const MAX_RESULTS = 24;
const MAX_CONTENT_CHARS = 700;

export function normalizeSalesResearchEvidence(results: PublicWebSearchResult[]): PublicWebSearchResult[] {
  const deduplicated = new Map<string, PublicWebSearchResult>();

  for (const result of results) {
    const url = typeof result.url === 'string' ? result.url.trim() : '';
    if (!url) continue;
    const content = typeof result.content === 'string' ? result.content.trim() : '';
    const normalized: PublicWebSearchResult = {
      title: typeof result.title === 'string' ? result.title.trim().slice(0, 240) : '',
      url,
      content: content.slice(0, MAX_CONTENT_CHARS),
      ...(typeof result.score === 'number' && Number.isFinite(result.score) ? { score: result.score } : {}),
    };

    const existing = deduplicated.get(url);
    if (!existing || normalized.content.length > existing.content.length) deduplicated.set(url, normalized);
  }

  return [...deduplicated.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_RESULTS);
}
