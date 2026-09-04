import type { LeadBusinessCandidate, LeadBusinessSearchOutput } from '../integrations/lead-research-integration.js';
import type { PublicWebSearchOutput, PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { LeadDiscoveryService } from './lead-discovery-service.js';
import type { LeadPublicWebEnrichmentService } from './lead-public-web-enrichment-service.js';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

export interface LeadResearchWorkflowInput {
  query: string;
  country?: string;
  maxBusinesses?: number;
  maxWebResultsPerBusiness?: number;
  executionId: string;
  correlationId: string;
  pageToken?: string;
}

export interface LeadResearchProposal {
  leadId: string;
  providerPlaceId: string;
  selectionStatus: 'ambiguous' | 'not_found';
  candidateUrls: string[];
  publicWebResults: PublicWebSearchResult[];
}

export interface EnrichedLeadResearchResult {
  leadId: string;
  providerPlaceId: string;
  companyName: string;
  officialWebsiteUrl: string | null;
  publicWebEvidence: PublicWebSearchResult[];
  websiteVerificationStatus: 'verified' | 'not_found';
  formattedAddress?: string;
}

export interface LeadResearchOutcomeCounts {
  enriched: number;
  duplicateSkipped: number;
  webResearchFailed: number;
  unresolved: number;
  ambiguous: number;
  notFound: number;
  skipped: number;
}

export interface LeadResearchWorkflowOutput {
  discovered: number;
  enriched: EnrichedLeadResearchResult[];
  proposals: LeadResearchProposal[];
  outcomes: LeadResearchOutcomeCounts;
  exhausted: boolean;
  hasMorePages: boolean;
  nextPageToken?: string;
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function webQueriesFor(candidate: LeadBusinessCandidate, discoveryQuery: string): string[] {
  const identity = [candidate.displayName, candidate.formattedAddress, discoveryQuery].filter(Boolean).join(' ');
  return [
    `${identity} official website projects tenders contracts growth expansion hiring digital transformation automation branding enquiries`,
    `${identity} contact details email directors owners founders management team leadership LinkedIn projects tenders deadline procurement`,
  ].map((query) => query.slice(0, 500));
}

export function createLeadResearchWorkflowService(
  registry: IntegrationRegistry,
  discoveryService: LeadDiscoveryService,
  enrichmentService: LeadPublicWebEnrichmentService,
) {
  return {
    async research(input: LeadResearchWorkflowInput): Promise<LeadResearchWorkflowOutput> {
      const query = requireText(input.query, 'query');
      const executionId = requireText(input.executionId, 'executionId');
      const correlationId = requireText(input.correlationId, 'correlationId');
      const maxBusinesses = input.maxBusinesses ?? 5;
      const maxWebResults = input.maxWebResultsPerBusiness ?? 5;
      const providerCandidateLimit = 20;

      const discovery = await registry.execute<{ query: string; maxResults: number; pageToken?: string }, LeadBusinessSearchOutput>({
        integrationId: 'research.google-places', operation: 'search_businesses', requestedBy: 'lead_agent', executionId, correlationId,
        mode: 'live', risk: 'low',
        input: { query, maxResults: providerCandidateLimit, ...(input.pageToken ? { pageToken: input.pageToken } : {}) },
      });
      if (discovery.status !== 'succeeded') throw new Error(`Google Places discovery failed: ${discovery.output.providerErrorCode ?? discovery.status}.`);

      const newCandidates: Array<{ candidate: LeadBusinessCandidate; leadId: string }> = [];
      let duplicateCount = 0;
      let skippedCount = 0;
      for (const candidate of discovery.output.candidates) {
        const persisted = await discoveryService.persistDiscovery({ discovery: { query: discovery.output.query, candidates: [candidate] }, actorId: 'lead_agent' });
        const skipped = persisted.skipped.find((item) => item.providerPlaceId === candidate.providerPlaceId);
        if (skipped) { skippedCount += 1; continue; }
        const duplicate = persisted.duplicates.find((item) => item.providerPlaceId === candidate.providerPlaceId);
        const leadId = persisted.created[0]?.id ?? duplicate?.leadId;
        if (!leadId) throw new Error(`Lead persistence produced no identity for ${candidate.providerPlaceId}.`);
        if (duplicate && !duplicate.enrichmentPending) duplicateCount += 1;
        else newCandidates.push({ candidate, leadId });
      }

      const enriched: EnrichedLeadResearchResult[] = [];
      const proposals: LeadResearchProposal[] = [];
      const outcomes: LeadResearchOutcomeCounts = {
        enriched: 0, duplicateSkipped: duplicateCount, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0, skipped: skippedCount,
      };

      let enrichedCount = 0;
      for (const { candidate, leadId } of newCandidates) {
        if (enrichedCount >= maxBusinesses) break;
        const webResults: PublicWebSearchResult[] = [];
        let successfulWebSearches = 0;
        for (const [searchIndex, webQuery] of webQueriesFor(candidate, query).entries()) {
          const web = await registry.execute<{ query: string; maxResults: number; country?: string }, PublicWebSearchOutput>({
            integrationId: 'research.tavily-web', operation: 'search_public_web', requestedBy: 'lead_agent',
            executionId: `${executionId}:${candidate.providerPlaceId}:web-${searchIndex + 1}`, correlationId, mode: 'live', risk: 'low',
            input: { query: webQuery, maxResults: maxWebResults, ...(input.country ? { country: input.country } : {}) },
          });
          if (web.status !== 'succeeded') continue;
          successfulWebSearches += 1;
          webResults.push(...web.output.results);
        }
        if (successfulWebSearches === 0) { outcomes.webResearchFailed += 1; continue; }

        const deduplicatedWebResults = [...new Map(webResults.filter((result) => result.url).map((result) => [result.url, result])).values()];
        const selection = selectOfficialWebsite({
          businessName: candidate.displayName,
          ...(candidate.formattedAddress ? { formattedAddress: candidate.formattedAddress } : {}),
          results: deduplicatedWebResults,
        });
        if (selection.status === 'ambiguous') {
          proposals.push({ leadId, providerPlaceId: candidate.providerPlaceId, selectionStatus: selection.status, candidateUrls: selection.candidateUrls, publicWebResults: deduplicatedWebResults });
          outcomes.unresolved += 1; outcomes.ambiguous += 1; continue;
        }

        const lead = await enrichmentService.enrich({
          leadId,
          companyName: selection.status === 'selected' ? selection.companyName : candidate.displayName,
          officialWebsiteUrl: selection.status === 'selected' ? selection.websiteUrl : null,
          supportingResults: deduplicatedWebResults,
          actorId: 'lead_agent',
        });
        enriched.push({
          leadId: lead.id,
          providerPlaceId: candidate.providerPlaceId,
          companyName: lead.companyName,
          officialWebsiteUrl: selection.status === 'selected' ? selection.websiteUrl : null,
          publicWebEvidence: deduplicatedWebResults,
          websiteVerificationStatus: selection.status === 'selected' ? 'verified' : 'not_found',
          formattedAddress: candidate.formattedAddress,
        });
        outcomes.enriched += 1; enrichedCount += 1;
        if (selection.status === 'not_found') outcomes.notFound += 1;
      }

      const hasMorePages = Boolean(discovery.output.nextPageToken);
      const exhausted = newCandidates.length === 0 && !hasMorePages;
      return {
        discovered: newCandidates.length, enriched, proposals, outcomes, exhausted, hasMorePages,
        ...(discovery.output.nextPageToken !== undefined ? { nextPageToken: discovery.output.nextPageToken } : {}),
      };
    },
  };
}

export type LeadResearchWorkflowService = ReturnType<typeof createLeadResearchWorkflowService>;
