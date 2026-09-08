import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { PublicWebSearchOutput, PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import type { LeadRecord } from '../data/operational-repository.js';

export interface SalesMissingContextRetrievalResult {
  leadId: string;
  missingFields: string[];
  searchesRun: number;
  evidence: PublicWebSearchResult[];
  nextAction: 'reassess_sales_context';
}

type SearchPlan = {
  query: (lead: LeadRecord) => string;
  officialOnly?: boolean;
  fallback?: (lead: LeadRecord) => string;
};

const FIELD_SEARCH_PLANS: Record<string, SearchPlan> = {
  decision_maker: {
    query: (lead) => `"${lead.companyName}" "managing director" director founder owner CEO leadership team`,
    officialOnly: true,
    fallback: (lead) => `"${lead.companyName}" "managing director" director founder owner CEO leadership LinkedIn`,
  },
  contact_email: {
    query: (lead) => `"${lead.companyName}" official contact email enquiries`,
    officialOnly: true,
    fallback: (lead) => `"${lead.companyName}" email contact enquiries telephone address`,
  },
  industry: {
    query: (lead) => `"${lead.companyName}" services sector industry company profile what does it do`,
    officialOnly: true,
    fallback: (lead) => `"${lead.companyName}" industry sector business services company`,
  },
  country: {
    query: (lead) => `"${lead.companyName}" headquarters address location South Africa`,
    officialOnly: false,
    fallback: (lead) => `"${lead.companyName}" contact address location country`,
  },
  business_summary: {
    query: (lead) => `"${lead.companyName}" about services capabilities projects company`,
    officialOnly: true,
    fallback: (lead) => `"${lead.companyName}" company profile services projects business`,
  },
  website_audit: {
    query: (lead) => `"${lead.companyName}" website services capabilities projects contact pages`,
    officialOnly: true,
    fallback: (lead) => `"${lead.companyName}" official website services capabilities projects contact`,
  },
  pain_points: {
    query: (lead) => `"${lead.companyName}" challenges growth expansion projects tenders contracts digital transformation`,
    officialOnly: false,
    fallback: (lead) => `"${lead.companyName}" website digital presence online customer acquisition business challenges`,
  },
  opportunity_summary: {
    query: (lead) => `"${lead.companyName}" current projects contracts tenders developments expansion opportunities news`,
    officialOnly: false,
    fallback: (lead) => `"${lead.companyName}" projects tenders contracts expansion latest news`,
  },
};

const HARD_FIELDS = new Set(['decision_maker', 'business_summary', 'website_audit', 'pain_points', 'opportunity_summary']);
const MIN_PRIMARY_RESULTS_BEFORE_FALLBACK = 2;
const MAX_RESULTS_PER_SEARCH = 5;

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const secondLevelTlds = new Set(['co.za', 'org.za', 'net.za', 'com.au', 'co.uk', 'org.uk']);
  const suffix = labels.slice(-2).join('.');
  return secondLevelTlds.has(suffix) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

function domainFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return registrableDomain(new URL(value).hostname);
  } catch {
    return null;
  }
}

function officialDomain(lead: LeadRecord): string | null {
  const direct = domainFromUrl((lead as LeadRecord & { officialWebsiteUrl?: unknown }).officialWebsiteUrl);
  if (direct) return direct;

  if (!Array.isArray(lead.evidence)) return null;
  for (const item of lead.evidence) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const domain = domainFromUrl(row.officialWebsiteUrl);
    if (domain) return domain;
  }
  return null;
}

function uniqueEvidence(results: PublicWebSearchResult[]): PublicWebSearchResult[] {
  const byUrl = new Map<string, PublicWebSearchResult>();
  for (const result of results) {
    const url = typeof result.url === 'string' ? result.url.trim() : '';
    if (!url) continue;
    const existing = byUrl.get(url);
    if (!existing || (result.content?.length ?? 0) > (existing.content?.length ?? 0)) byUrl.set(url, result);
  }
  return [...byUrl.values()];
}

export function createSalesMissingContextRetrievalService(registry: IntegrationRegistry) {
  return {
    async retrieve(input: {
      lead: LeadRecord;
      missingFields: string[];
      executionId: string;
      correlationId: string;
      country?: string;
    }): Promise<SalesMissingContextRetrievalResult> {
      const leadId = requiredText(input.lead.id, 'lead.id');
      const executionId = requiredText(input.executionId, 'executionId');
      const correlationId = requiredText(input.correlationId, 'correlationId');
      const missingFields = [...new Set(input.missingFields.map((field) => field.trim()).filter(Boolean))];
      const evidence: PublicWebSearchResult[] = [];
      let searchesRun = 0;
      const domain = officialDomain(input.lead);
      const searchedQueries = new Set<string>();

      const executeSearch = async (query: string, suffix: string, includeOfficialDomain: boolean) => {
        const normalizedQuery = query.trim();
        if (!normalizedQuery || searchedQueries.has(normalizedQuery)) return 0;
        searchedQueries.add(normalizedQuery);
        const web = await registry.execute<{
          query: string;
          maxResults: number;
          country?: string;
          includeDomains?: string[];
        }, PublicWebSearchOutput>({
          integrationId: 'research.tavily-web',
          operation: 'search_public_web',
          requestedBy: 'lead_agent',
          executionId: `${executionId}:sales-context:${suffix}`,
          correlationId,
          mode: 'live',
          risk: 'low',
          input: {
            query: normalizedQuery.slice(0, 400),
            maxResults: MAX_RESULTS_PER_SEARCH,
            ...(input.country ? { country: input.country } : {}),
            ...(domain && includeOfficialDomain ? { includeDomains: [domain] } : {}),
          },
        });
        if (web.status !== 'succeeded') return 0;
        searchesRun += 1;
        evidence.push(...web.output.results);
        return web.output.results.length;
      };

      if (missingFields.length > 0) {
        await executeSearch(
          `"${input.lead.companyName}" company profile services projects contact leadership`,
          'aggregate-company-profile',
          false,
        );
      }

      for (const field of missingFields) {
        const plan = FIELD_SEARCH_PLANS[field];
        if (!plan) continue;

        const primaryCount = await executeSearch(
          plan.query(input.lead),
          `field-${field}-primary`,
          Boolean(domain && plan.officialOnly),
        );

        if (
          plan.fallback &&
          (HARD_FIELDS.has(field) || field === 'contact_email') &&
          primaryCount < MIN_PRIMARY_RESULTS_BEFORE_FALLBACK
        ) {
          await executeSearch(
            plan.fallback(input.lead),
            `field-${field}-fallback`,
            field === 'business_summary' || field === 'website_audit',
          );
        }
      }

      return {
        leadId,
        missingFields,
        searchesRun,
        evidence: uniqueEvidence(evidence),
        nextAction: 'reassess_sales_context',
      };
    },
  };
}

export type SalesMissingContextRetrievalService = ReturnType<typeof createSalesMissingContextRetrievalService>;
