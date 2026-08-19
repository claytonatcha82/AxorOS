export interface LeadBusinessSearchInput {
  query: string;
  maxResults?: number;
}

export interface LeadBusinessCandidate {
  providerPlaceId: string;
  displayName: string;
  formattedAddress?: string;
  types: string[];
  source: 'google_places';
}

export interface LeadBusinessSearchOutput {
  query: string;
  candidates: LeadBusinessCandidate[];
}

export function validateLeadBusinessSearchInput(input: LeadBusinessSearchInput): string[] {
  const errors: string[] = [];
  const query = input.query?.trim();
  if (!query) errors.push('query is required.');
  if (query && query.length > 200) errors.push('query must be 200 characters or fewer.');
  if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 20)) {
    errors.push('maxResults must be an integer between 1 and 20.');
  }
  return errors;
}
