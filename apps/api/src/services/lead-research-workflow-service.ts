import type { LeadBusinessCandidate, LeadBusinessSearchOutput } from '../integrations/lead-research-integration.js';
import type { PublicWebSearchOutput, PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { LeadDiscoveryService } from './lead-discovery-service.js';

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
  publicWebResults: PublicWebSearchResult[];
}

export interface LeadResearchWorkflowOutput {
  discovered: number;
  proposals: LeadResearchProposal[];
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

export function createLeadResearchWorkflowService(registry: IntegrationRegistry, discoveryService: LeadDiscoveryService) {
  return {
    async research(input: LeadResearchWorkflowInput): Promise<LeadResearchWorkflowOutput> {
      const query = requireText(input.query, 'query');
      const executionId = requireText(input.executionId, 'executionId');
      const correlationId = requireText(input.correlationId, 'correlationId');
      const maxBusinesses = input.maxBusinesses ?? 5;
      const maxWebResults = input.maxWebResultsPerBusiness ?? 5;

      const discovery = await registry.execute<{ query: string; maxResults: number }, LeadBusinessSearchOutput>({
        integrationId: 'research.google-places',
        operation: 'search_businesses',
        requestedBy: 'lead_agent',
        executionId,
        correlationId,
        mode: 'live',
        risk: 'low',
        input: { query, maxResults: maxBusinesses },
      });
      if (discovery.status !== 'succeeded') {
        throw new Error(`Google Places discovery failed: ${discovery.output.providerErrorCode ?? discovery.status}.`);
      }

      const proposals: LeadResearchProposal[] = [];
      for (const candidate of discovery.output.candidates) {
        // Persist one candidate at a time so the returned lead ID remains bound to the
        // exact provider identity even when some discoveries are duplicates.
        const persisted = await discoveryService.persistDiscovery({
          discovery: { query: discovery.output.query, candidates: [candidate] },
          actorId: 'lead_agent',
        });
        const leadId = persisted.created[0]?.id ?? persisted.duplicates[0]?.leadId;
        if (!leadId) throw new Error(`Lead persistence produced no identity for ${candidate.providerPlaceId}.`);

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
        if (web.status !== 'succeeded') continue;

        proposals.push({
          leadId,
          providerPlaceId: candidate.providerPlaceId,
          publicWebResults: web.output.results,
        });
      }

      return { discovered: discovery.output.candidates.length, proposals };
    },
  };
}

export type LeadResearchWorkflowService = ReturnType<typeof createLeadResearchWorkflowService>;
