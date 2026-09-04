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
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
    types?: string[];
  }>;
  nextPageToken?: string;
  error?: {
    code?: number;
    status?: string;
    message?: string;
  };
}

export interface GooglePlacesLeadResearchIntegrationOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  regionCode?: string;
}

const NON_BUSINESS_PLACE_TYPES = new Set([
  'locality', 'political', 'administrative_area_level_1', 'administrative_area_level_2',
  'administrative_area_level_3', 'administrative_area_level_4', 'administrative_area_level_5',
  'administrative_area_level_6', 'administrative_area_level_7', 'sublocality', 'sublocality_level_1',
  'sublocality_level_2', 'sublocality_level_3', 'sublocality_level_4', 'sublocality_level_5',
  'country', 'postal_code', 'postal_code_prefix', 'postal_code_suffix', 'natural_feature',
  'colloquial_area', 'continent', 'plus_code', 'archipelago', 'landmark',
]);

function isBusinessCandidate(types: string[]): boolean {
  if (types.length === 0) return false;
  return types.some((type) => !NON_BUSINESS_PLACE_TYPES.has(type));
}

const FIELD_MASK = 'places.id,places.displayName.text,places.formattedAddress,places.addressComponents,places.types,nextPageToken';

function sanitizeProviderMessage(message: string | undefined, apiKey: string): string | undefined {
  const trimmed = message?.trim();
  if (!trimmed) return undefined;
  return trimmed.replaceAll(apiKey, '[REDACTED]').slice(0, 500);
}

function normalizeCountry(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function targetCountryCode(country: string | undefined): string | undefined {
  const normalized = normalizeCountry(country ?? '');
  if (!normalized) return undefined;
  const aliases: Record<string, string> = {
    za: 'ZA', 'south africa': 'ZA', 'republic of south africa': 'ZA',
    bw: 'BW', botswana: 'BW',
    na: 'NA', namibia: 'NA',
    zm: 'ZM', zambia: 'ZM',
    zw: 'ZW', zimbabwe: 'ZW',
    mz: 'MZ', mozambique: 'MZ',
    ls: 'LS', lesotho: 'LS',
    sz: 'SZ', eswatini: 'SZ', swaziland: 'SZ',
  };
  return aliases[normalized] ?? (normalized.length === 2 ? normalized.toUpperCase() : undefined);
}

function countryCodeFromPlace(place: GooglePlacesSearchResponse['places'][number]): string | undefined {
  const component = place.addressComponents?.find((item) => item.types?.includes('country'));
  const code = component?.shortText?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

export function createGooglePlacesLeadResearchIntegration(
  options: GooglePlacesLeadResearchIntegrationOptions,
): ExternalIntegration<LeadBusinessSearchInput, LeadBusinessSearchOutput> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Google Places API key is required.');
  const regionCode = (options.regionCode?.trim() || 'ZA').toUpperCase();
  if (!/^[A-Z]{2}$/.test(regionCode)) throw new Error('Google Places regionCode must be a two-letter ISO 3166-1 alpha-2 code.');
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
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'blocked', output: { ...blockedOutput, providerErrorCode: 'INTEGRATION_POLICY_VIOLATION', providerErrorMessage: 'Operation not supported: expected search_businesses.' }, evidenceReferences: [], retryable: false };
      }
      if (request.requestedBy !== 'lead_agent' && request.requestedBy !== 'human_executive') {
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'blocked', output: { ...blockedOutput, providerErrorCode: 'INTEGRATION_POLICY_VIOLATION', providerErrorMessage: 'Requester not authorized: expected lead_agent or human_executive.' }, evidenceReferences: [], retryable: false };
      }
      if (request.mode !== 'live' || request.risk !== 'low') {
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'blocked', output: { ...blockedOutput, providerErrorCode: 'INTEGRATION_POLICY_VIOLATION', providerErrorMessage: 'Mode/risk not supported: expected live/low.' }, evidenceReferences: [], retryable: false };
      }

      const inputErrors = validateLeadBusinessSearchInput(request.input);
      if (inputErrors.length > 0) {
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'blocked', output: { ...blockedOutput, providerErrorCode: 'INPUT_VALIDATION_FAILED', providerErrorMessage: `Input validation failed: ${inputErrors.join('; ')}` }, evidenceReferences: [], retryable: false };
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/places:searchText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
          body: JSON.stringify({
            textQuery: request.input.query.trim(),
            maxResultCount: request.input.maxResults ?? 10,
            regionCode,
            ...(request.input.pageToken ? { pageToken: request.input.pageToken } : {}),
          }),
        });
      } catch {
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'failed', output: { ...blockedOutput, providerErrorCode: 'NETWORK_ERROR', providerErrorMessage: 'Google Places request failed before an HTTP response was received.' }, evidenceReferences: [], retryable: true };
      }

      let rawBody = '';
      try {
        rawBody = await response.text();
      } catch {
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'failed', output: { ...blockedOutput, providerErrorCode: `HTTP_${response.status}`, providerErrorMessage: 'Google Places response body could not be read.' }, evidenceReferences: [], retryable: response.status === 429 || response.status >= 500 };
      }

      let payload: GooglePlacesSearchResponse = {};
      if (rawBody.trim()) {
        try { payload = JSON.parse(rawBody) as GooglePlacesSearchResponse; }
        catch {
          return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'failed', output: { ...blockedOutput, providerErrorCode: `HTTP_${response.status}`, providerErrorMessage: sanitizeProviderMessage(rawBody, apiKey) ?? 'Google Places returned an unexpected response.' }, evidenceReferences: [], retryable: !response.ok && (response.status === 429 || response.status >= 500) };
        }
      }

      if (!response.ok) {
        const providerErrorCode = payload.error?.status?.trim() || (payload.error?.code !== undefined ? String(payload.error.code) : `HTTP_${response.status}`);
        const providerErrorMessage = sanitizeProviderMessage(payload.error?.message, apiKey) ?? sanitizeProviderMessage(rawBody, apiKey) ?? 'Google Places request failed without a provider message.';
        return { integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'failed', output: { ...blockedOutput, providerErrorCode, providerErrorMessage }, evidenceReferences: [], retryable: response.status === 429 || response.status >= 500 };
      }

      const targetCode = targetCountryCode(request.input.country);
      const candidates: LeadBusinessCandidate[] = (payload.places ?? [])
        .map((place): LeadBusinessCandidate | null => {
          const providerPlaceId = place.id?.trim();
          const displayName = place.displayName?.text?.trim();
          if (!providerPlaceId || !displayName) return null;
          const types = Array.isArray(place.types) ? place.types.filter((type) => typeof type === 'string' && type.trim()).map((type) => type.trim()) : [];
          if (!isBusinessCandidate(types)) return null;
          const countryCode = countryCodeFromPlace(place);
          // When Google provides a country component, an explicit mismatch is a hard
          // reject. Missing country data is retained rather than falsely rejecting a
          // valid local business, since regionCode can cause Google to omit the country
          // from otherwise valid South African addresses.
          if (targetCode && countryCode && countryCode !== targetCode) return null;
          return {
            providerPlaceId,
            displayName,
            ...(place.formattedAddress?.trim() ? { formattedAddress: place.formattedAddress.trim() } : {}),
            ...(countryCode ? { countryCode } : {}),
            types,
            source: 'google_places',
          };
        })
        .filter((candidate): candidate is LeadBusinessCandidate => candidate !== null);

      return {
        integrationId: 'research.google-places', operation: request.operation, provider: 'google-places', mode: request.mode, status: 'succeeded',
        output: { query: request.input.query.trim(), candidates, ...(payload.nextPageToken?.trim() ? { nextPageToken: payload.nextPageToken.trim() } : {}) },
        evidenceReferences: candidates.map((candidate) => `google-places:place:${candidate.providerPlaceId}`), retryable: false,
      };
    },
  };
}
