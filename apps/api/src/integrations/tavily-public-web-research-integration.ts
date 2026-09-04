import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import type { PublicWebSearchInput, PublicWebSearchOutput, PublicWebSearchResult } from './public-web-research-integration.js';
import { validatePublicWebSearchInput } from './public-web-research-integration.js';

export interface TavilyPublicWebResearchIntegrationOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface TavilySearchResponse {
  query?: unknown;
  results?: unknown;
  request_id?: unknown;
}

function sanitizeMessage(message: string, apiKey: string): string {
  return message.replaceAll(apiKey, '[REDACTED]').slice(0, 500);
}

function mapResults(value: unknown): PublicWebSearchResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: PublicWebSearchResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (typeof row.title !== 'string' || typeof row.url !== 'string' || typeof row.content !== 'string') return null;
    let parsed: URL;
    try {
      parsed = new URL(row.url);
    } catch {
      return null;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    results.push({
      title: row.title,
      url: parsed.toString(),
      content: row.content,
      ...(typeof row.score === 'number' && Number.isFinite(row.score) ? { score: row.score } : {}),
    });
  }
  return results;
}

export function createTavilyPublicWebResearchIntegration(options: TavilyPublicWebResearchIntegrationOptions): ExternalIntegration<PublicWebSearchInput, PublicWebSearchOutput> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Tavily API key is required.');
  const baseUrl = (options.baseUrl ?? 'https://api.tavily.com').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    integrationId: 'research.tavily-web',
    kind: 'other',
    provider: 'tavily',
    supportedModes: ['live'],
    supportedOperations: ['search_public_web'],

    async execute(request: IntegrationRequest<PublicWebSearchInput>): Promise<IntegrationResponse<PublicWebSearchOutput>> {
      const outputBase: PublicWebSearchOutput = { query: request.input.query?.trim() ?? '', results: [] };
      if (request.operation !== 'search_public_web') {
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'blocked', output: outputBase, evidenceReferences: [], retryable: false };
      }
      if (request.requestedBy !== 'lead_agent' && request.requestedBy !== 'human_executive') {
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'blocked', output: outputBase, evidenceReferences: [], retryable: false };
      }
      if (request.mode !== 'live' || request.risk !== 'low') {
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'blocked', output: outputBase, evidenceReferences: [], retryable: false };
      }

      const errors = validatePublicWebSearchInput(request.input);
      if (errors.length > 0) {
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'failed', output: { ...outputBase, providerErrorCode: 'VALIDATION_ERROR', providerErrorMessage: errors.join(' ') }, evidenceReferences: [], retryable: false };
      }

      let response: Response;
      try {
        const body: Record<string, unknown> = {
          query: request.input.query.trim(),
          search_depth: 'basic',
          topic: 'general',
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          max_results: request.input.maxResults ?? 5,
          ...(request.input.country ? { country: request.input.country.trim().toLowerCase() } : {}),
          ...(request.input.includeDomains?.length ? { include_domains: request.input.includeDomains } : {}),
        };
        response = await fetchImpl(`${baseUrl}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'failed', output: { ...outputBase, providerErrorCode: 'NETWORK_ERROR', providerErrorMessage: sanitizeMessage(message, apiKey) }, evidenceReferences: [], retryable: true };
      }

      const raw = await response.text();
      let parsed: TavilySearchResponse | Record<string, unknown> | null = null;
      try { parsed = raw ? JSON.parse(raw) as TavilySearchResponse : {}; } catch { parsed = null; }

      if (!response.ok) {
        const errorObject = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
        const detail = typeof errorObject?.detail === 'string' ? errorObject.detail : raw || response.statusText;
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'failed', output: { ...outputBase, providerErrorCode: `HTTP_${response.status}`, providerErrorMessage: sanitizeMessage(detail, apiKey) }, evidenceReferences: [], retryable: response.status === 429 || response.status >= 500 };
      }

      if (!parsed) {
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'failed', output: { ...outputBase, providerErrorCode: 'INVALID_RESPONSE', providerErrorMessage: 'Tavily returned a non-JSON response.' }, evidenceReferences: [], retryable: false };
      }
      const results = mapResults((parsed as TavilySearchResponse).results);
      if (!results) {
        return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'failed', output: { ...outputBase, providerErrorCode: 'INVALID_RESPONSE', providerErrorMessage: 'Tavily returned malformed search results.' }, evidenceReferences: [], retryable: false };
      }

      const evidenceReferences = results.map((result) => `public-web:${result.url}`);
      const requestId = typeof (parsed as TavilySearchResponse).request_id === 'string' ? (parsed as TavilySearchResponse).request_id as string : undefined;
      return {
        integrationId: this.integrationId,
        operation: request.operation,
        provider: this.provider,
        mode: request.mode,
        status: 'succeeded',
        output: { query: request.input.query.trim(), results },
        ...(requestId ? { externalReference: requestId } : {}),
        evidenceReferences,
        retryable: false,
      };
    },
  };
}
