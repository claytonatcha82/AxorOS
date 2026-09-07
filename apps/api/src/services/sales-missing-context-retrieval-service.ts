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

const FIELD_QUERIES: Record<string, (lead: LeadRecord) => string> = {
  decision_maker: (lead) => `${lead.companyName} directors owners founders management team leadership contact`,
  contact_email: (lead) => `${lead.companyName} official email contact email enquiries`,
  industry: (lead) => `${lead.companyName} industry business services company profile`,
  country: (lead) => `${lead.companyName} location country headquarters address`,
  business_summary: (lead) => `${lead.companyName} about company services projects business`,
  website_audit: (lead) => `${lead.companyName} official website services projects capabilities contact`,
  pain_points: (lead) => `${lead.companyName} challenges projects growth expansion tenders contracts digital transformation`,
  opportunity_summary: (lead) => `${lead.companyName} current projects contracts tenders developments expansion opportunities`,
};

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

function officialDomain(lead: LeadRecord): string | null {
  if (!Array.isArray(lead.evidence)) return null;
  for (const item of lead.evidence) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.officialWebsiteUrl === 'string' && row.officialWebsiteUrl.trim()) {
      try { return registrableDomain(new URL(row.officialWebsiteUrl).hostname); } catch { return null; }
    }
  }
  return null;
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

      for (const field of missingFields) {
        const builder = FIELD_QUERIES[field];
        if (!builder) continue;
        const web = await registry.execute<{ query: string; maxResults: number; country?: string; includeDomains?: string[] }, PublicWebSearchOutput>({
          integrationId: 'research.tavily-web',
          operation: 'search_public_web',
          requestedBy: 'sales_agent',
          executionId: `${executionId}:sales-context:${field}`,
          correlationId,
          mode: 'live',
          risk: 'low',
          input: {
            query: builder(input.lead).slice(0, 400),
            maxResults: 5,
            ...(input.country ? { country: input.country } : {}),
            ...(domain && (field === 'website_audit' || field === 'business_summary') ? { includeDomains: [domain] } : {}),
          },
        });
        if (web.status !== 'succeeded') continue;
        searchesRun += 1;
        evidence.push(...web.output.results);
      }

      const deduplicatedEvidence = [...new Map(evidence.filter((item) => item.url).map((item) => [item.url, item])).values()];
      return { leadId, missingFields, searchesRun, evidence: deduplicatedEvidence, nextAction: 'reassess_sales_context' };
    },
  };
}

export type SalesMissingContextRetrievalService = ReturnType<typeof createSalesMissingContextRetrievalService>;
