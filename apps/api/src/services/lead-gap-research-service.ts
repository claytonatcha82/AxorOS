import type { PublicWebSearchInput, PublicWebSearchOutput, PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { QualificationCategory } from './lead-preliminary-qualification-service.js';

export interface LeadGapResearchInput {
  companyName: string;
  officialWebsiteUrl: string | null;
  formattedAddress?: string;
  missingCategories: QualificationCategory[];
  existingEvidence: PublicWebSearchResult[];
  executionId: string;
  correlationId: string;
  country?: string;
  maxResultsPerSearch?: number;
}

export interface LeadGapResearchOutput {
  additionalResults: PublicWebSearchResult[];
  searchesPerformed: number;
  categoriesResearched: QualificationCategory[];
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function deduplicateByUrl(results: PublicWebSearchResult[]): PublicWebSearchResult[] {
  return [...new Map(results.filter((r) => r.url).map((r) => [r.url, r])).values()];
}

function buildGapQueries(
  category: QualificationCategory,
  companyName: string,
  location: string,
  domain: string | null,
): Array<{ query: string; includeDomains?: string[] }> {
  const identity = [companyName, location].filter(Boolean).join(' ');

  switch (category) {
    case 'businessFit':
      return [
        { query: `${identity} established employees staff size revenue turnover growth history about`.slice(0, 400) },
        ...(domain ? [{ query: 'about company history team size growth'.slice(0, 400), includeDomains: [domain] }] : []),
      ];
    case 'projectFit':
      return [
        { query: `${identity} website redesign digital transformation new website CRM ERP software automation branding enquiries`.slice(0, 400) },
        ...(domain ? [{ query: 'services projects case studies portfolio digital'.slice(0, 400), includeDomains: [domain] }] : []),
      ];
    case 'partnershipPotential':
      return [
        { query: `${identity} expansion new branches locations growth ongoing projects recurring services long-term`.slice(0, 400) },
        ...(domain ? [{ query: 'about news expansion growth branches locations'.slice(0, 400), includeDomains: [domain] }] : []),
      ];
    case 'decisionMakerAccess':
      return [
        { query: `${identity} directors owners management team leadership contact`.slice(0, 400) },
        { query: `${identity} LinkedIn company leadership directors founders`.slice(0, 400) },
        ...(domain ? [{ query: 'about team leadership directors management contact'.slice(0, 400), includeDomains: [domain] }] : []),
      ];
    case 'commercialFit':
      return [
        { query: `${identity} tender contract awarded procurement project value budget revenue`.slice(0, 400) },
        ...(domain ? [{ query: 'projects tenders clients contracts commercial'.slice(0, 400), includeDomains: [domain] }] : []),
      ];
    case 'timeline':
      return [
        { query: `${identity} tender deadline project commencement hiring 2026 2027 expansion timeline launch`.slice(0, 400) },
        ...(domain ? [{ query: 'news blog projects careers deadlines launch'.slice(0, 400), includeDomains: [domain] }] : []),
      ];
    default:
      return [];
  }
}

export function createLeadGapResearchService(registry: IntegrationRegistry) {
  return {
    async researchGaps(input: LeadGapResearchInput): Promise<LeadGapResearchOutput> {
      const companyName = requireText(input.companyName, 'companyName');
      const executionId = requireText(input.executionId, 'executionId');
      const correlationId = requireText(input.correlationId, 'correlationId');
      const maxResults = input.maxResultsPerSearch ?? 5;
      const domain = input.officialWebsiteUrl ? extractDomain(input.officialWebsiteUrl) : null;
      const location = input.formattedAddress ?? '';
      const existingUrls = new Set(input.existingEvidence.map((result) => result.url));
      const additionalResults: PublicWebSearchResult[] = [];
      let searchesPerformed = 0;
      const categoriesResearched: QualificationCategory[] = [];
      const MAX_SEARCHES = 6;

      for (const category of input.missingCategories) {
        if (searchesPerformed >= MAX_SEARCHES) break;
        const queries = buildGapQueries(category, companyName, location, domain);
        let categoryHadResults = false;

        for (const { query, includeDomains } of queries) {
          if (searchesPerformed >= MAX_SEARCHES) break;
          const web = await registry.execute<PublicWebSearchInput, PublicWebSearchOutput>({
            integrationId: 'research.tavily-web',
            operation: 'search_public_web',
            requestedBy: 'lead_agent',
            executionId: `${executionId}:gap-${category}-${searchesPerformed + 1}`,
            correlationId,
            mode: 'live',
            risk: 'low',
            input: {
              query,
              maxResults,
              ...(input.country ? { country: input.country } : {}),
              ...(includeDomains ? { includeDomains } : {}),
            },
          });
          searchesPerformed += 1;
          if (web.status === 'succeeded' && web.output.results.length > 0) {
            for (const result of web.output.results) {
              if (!existingUrls.has(result.url)) additionalResults.push(result);
            }
            categoryHadResults = true;
          }
        }
        if (categoryHadResults || queries.length > 0) categoriesResearched.push(category);
      }

      return {
        additionalResults: deduplicateByUrl(additionalResults),
        searchesPerformed,
        categoriesResearched: [...new Set(categoriesResearched)],
      };
    },
  };
}

export type LeadGapResearchService = ReturnType<typeof createLeadGapResearchService>;
