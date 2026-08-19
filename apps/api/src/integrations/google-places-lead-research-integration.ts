import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import {
  validateLeadBusinessSearchInput,
  type LeadBusinessCandidate,
  type LeadBusinessSearchInput,
  type LeadBusinessSearchOutput,
} from './lead-research-integration.js';

interface GooglePlacesSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    types?: string[];
  }>;
}

export interface GooglePlacesLeadResearchIntegrationOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const FIELD_MASK = 'places.id,places.displayName.text,places.formattedAddress,places.types';

export function createGooglePlacesLeadResearchIntegration(
  options: GooglePlacesLeadResearchIntegrationOptions,
): ExternalIntegration<LeadBusinessSearchInput, LeadBusinessSearchOutput> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Google Places API key is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://places.googleapis.com/v1').replace(/\/$/, '');

  return {
    integrationId: 'research.google-places',
    kind: 'other',
    provider: 'google-places',
    supportedModes: ['live'],
    supportedOperations: ['search_businesses'],

    async execute(
      request: IntegrationRequest<LeadBusinessSearchInput>,
    ): Promise<IntegrationResponse<LeadBusinessSearchOutput>> {
      const blockedOutput: LeadBusinessSearchOutput = {
        query: request.input.query?.trim() ?? '',
        candidates: [],
      };

      if (request.operation !== 'search_businesses') {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'blocked',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: false,
        };
      }

      if (request.requestedBy !== 'lead_agent' && request.requestedBy !== 'human_executive') {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'blocked',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: false,
        };
      }

      if (request.mode !== 'live' || request.risk !== 'low') {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'blocked',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: false,
        };
      }

      const inputErrors = validateLeadBusinessSearchInput(request.input);
      if (inputErrors.length > 0) {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'blocked',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: false,
        };
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/places:searchText`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery: request.input.query.trim(),
            maxResultCount: request.input.maxResults ?? 10,
          }),
        });
      } catch {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'failed',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: true,
        };
      }

      let payload: GooglePlacesSearchResponse;
      try {
        payload = await response.json() as GooglePlacesSearchResponse;
      } catch {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'failed',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: response.status >= 500,
        };
      }

      if (!response.ok) {
        return {
          integrationId: 'research.google-places',
          operation: request.operation,
          provider: 'google-places',
          mode: request.mode,
          status: 'failed',
          output: blockedOutput,
          evidenceReferences: [],
          retryable: response.status === 429 || response.status >= 500,
        };
      }

      const candidates: LeadBusinessCandidate[] = (payload.places ?? [])
        .map((place): LeadBusinessCandidate | null => {
          const providerPlaceId = place.id?.trim();
          const displayName = place.displayName?.text?.trim();
          if (!providerPlaceId || !displayName) return null;
          return {
            providerPlaceId,
            displayName,
            ...(place.formattedAddress?.trim() ? { formattedAddress: place.formattedAddress.trim() } : {}),
            types: Array.isArray(place.types) ? place.types.filter((type) => typeof type === 'string' && type.trim()).map((type) => type.trim()) : [],
            source: 'google_places',
          };
        })
        .filter((candidate): candidate is LeadBusinessCandidate => candidate !== null);

      return {
        integrationId: 'research.google-places',
        operation: request.operation,
        provider: 'google-places',
        mode: request.mode,
        status: 'succeeded',
        output: {
          query: request.input.query.trim(),
          candidates,
        },
        evidenceReferences: candidates.map((candidate) => `google-places:place:${candidate.providerPlaceId}`),
        retryable: false,
      };
    },
  };
}
