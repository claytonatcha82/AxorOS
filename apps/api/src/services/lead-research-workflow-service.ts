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
}

export interface LeadResearchOutcomeCounts {
  enriched: number;
  duplicateSkipped: number;
  webResearchFailed: number;
  unresolved: number;
  ambiguous: number;
  notFound: number;
}

export interface LeadResearchWorkflowOutput {
  discovered: number;
  enriched: EnrichedLeadResearchResult[];
  proposals: LeadResearchProposal[];
  outcomes: LeadResearchOutcomeCounts;
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function webQueryFor(candidate: LeadBusinessCandidate): string {
  const parts = [candidate.displayName, candidate.formattedAddress, 'official website'].filter(Boolean);
  return parts.join(' ').slice(0, 400);
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
      const providerCandidateLimit = Math.min(20, Math.max(maxBusinesses, maxBusinesses * 3));

      const discovery = await registry.execute<{ query: string; maxResults: number }, LeadBusinessSearchOutput>({
        integrationId: 'research.google-places',
        operation: 'search_businesses',
        requestedBy: 'lead_agent',
        executionId,
        correlationId,
        mode: 'live',
        risk: 'low',
        input: { query, maxResults: providerCandidateLimit },
      });
      if (discovery.status !== 'succeeded') {
        throw new Error(`Google Places discovery failed: ${discovery.output.providerErrorCode ?? discovery.status}.`);
      }

      const enriched: EnrichedLeadResearchResult[] = [];
      const proposals: LeadResearchProposal[] = [];
      const outcomes: LeadResearchOutcomeCounts = {
        enriched: 0,
        duplicateSkipped: 0,
        webResearchFailed: 0,
        unresolved: 0,
        ambiguous: 0,
        notFound: 0,
      };
      let actionableDiscovered = 0;
      for (const candidate of discovery.output.candidates) {
        const persisted = await discoveryService.persistDiscovery({
          discovery: { query: discovery.output.query, candidates: [candidate] },
          actorId: 'lead_agent',
        });
        const duplicate = persisted.duplicates.find((item) => item.providerPlaceId === candidate.providerPlaceId);
        const leadId = persisted.created[0]?.id ?? duplicate?.leadId;
        if (!leadId) throw new Error(`Lead persistence produced no identity for ${candidate.providerPlaceId}.`);
        if (duplicate && !duplicate.enrichmentPending) {
          outcomes.duplicateSkipped += 1;
          continue;
        }

        actionableDiscovered += 1;
        const web = await registry.execute<{ query: string; maxResults: number; country?: string }, PublicWebSearchOutput>({
          integrationId: 'research.tavily-web',
          operation: 'search_public_web',
          requestedBy: 'lead_agent',
          executionId: `${executionId}:${candidate.providerPlaceId}`,
          correlationId,
          mode: 'live',
          risk: 'low',
          input: {
            query: webQueryFor(candidate),
            maxResults: maxWebResults,
            ...(input.country ? { country: input.country } : {}),
          },
        });
        if (web.status !== 'succeeded') {
          outcomes.webResearchFailed += 1;
          if (actionableDiscovered >= maxBusinesses) break;
          continue;
        }

        const selection = selectOfficialWebsite({
          businessName: candidate.displayName,
          ...(candidate.formattedAddress ? { formattedAddress: candidate.formattedAddress } : {}),
          results: web.output.results,
        });

        if (selection.status === 'ambiguous') {
          proposals.push({
            leadId,
            providerPlaceId: candidate.providerPlaceId,
            selectionStatus: selection.status,
            candidateUrls: selection.candidateUrls,
            publicWebResults: web.output.results,
          });
          outcomes.unresolved += 1;
          outcomes.ambiguous += 1;
          if (actionableDiscovered >= maxBusinesses) break;
          continue;
        }

        // No verified website is an opportunity state, not a failed business
        // identity. Preserve the business and evidence so qualification can assess
        // the lead and explicitly surface the missing website as an opportunity.
        const lead = await enrichmentService.enrich({
          leadId,
          companyName: selection.status === 'selected' ? selection.companyName : candidate.displayName,
          officialWebsiteUrl: selection.status === 'selected' ? selection.websiteUrl : null,
          supportingResults: web.output.results,
          actorId: 'lead_agent',
        });
        enriched.push({
          leadId: lead.id,
          providerPlaceId: candidate.providerPlaceId,
          companyName: lead.companyName,
          officialWebsiteUrl: selection.status === 'selected' ? selection.websiteUrl : null,
          publicWebEvidence: web.output.results,
          websiteVerificationStatus: selection.status === 'selected' ? 'verified' : 'not_found',
        });
        outcomes.enriched += 1;
        if (selection.status === 'not_found') outcomes.notFound += 1;
        if (actionableDiscovered >= maxBusinesses) break;
      }

      return { discovered: actionableDiscovered, enriched, proposals, outcomes };
    },
  };
}

export type LeadResearchWorkflowService = ReturnType<typeof createLeadResearchWorkflowService>;
