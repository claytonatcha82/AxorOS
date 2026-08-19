export interface PublicWebSearchInput {
  query: string;
  maxResults?: number;
  country?: string;
}

export interface PublicWebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface PublicWebSearchOutput {
  query: string;
  results: PublicWebSearchResult[];
  providerErrorCode?: string;
  providerErrorMessage?: string;
}

export function validatePublicWebSearchInput(input: PublicWebSearchInput): string[] {
  const errors: string[] = [];
  const query = input.query?.trim();
  if (!query) errors.push('query is required.');
  if (query && query.length > 400) errors.push('query must be 400 characters or fewer.');
  if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 10)) {
    errors.push('maxResults must be an integer between 1 and 10.');
  }
  if (input.country !== undefined && (!input.country.trim() || input.country.trim().length > 80)) {
    errors.push('country must be 80 characters or fewer.');
  }
  return errors;
}
