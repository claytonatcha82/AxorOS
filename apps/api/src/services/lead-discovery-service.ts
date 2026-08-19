import type { LeadBusinessCandidate, LeadBusinessSearchOutput } from '../integrations/lead-research-integration.js';
import type { LeadRecord, OperationalRepository } from '../data/operational-repository.js';
import type { TransactionRunner } from '../data/transaction.js';

export interface PersistLeadDiscoveryInput {
  discovery: LeadBusinessSearchOutput;
  actorId?: string;
}

export interface PersistLeadDiscoveryResult {
  created: LeadRecord[];
  duplicates: Array<{ providerPlaceId: string; leadId: string }>;
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function googlePlaceEvidence(providerPlaceId: string, query: string) {
  return {
    kind: 'lead_discovery',
    provider: 'google_places',
    providerPlaceId,
    query,
    evidenceReference: `google-places:place:${providerPlaceId}`,
  } as const;
}

function evidenceContainsGooglePlace(evidence: unknown, providerPlaceId: string): boolean {
  if (!Array.isArray(evidence)) return false;
  return evidence.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, unknown>;
    return value.provider === 'google_places' && value.providerPlaceId === providerPlaceId;
  });
}

function candidateSummary(candidate: LeadBusinessCandidate): string | undefined {
  const types = candidate.types.slice(0, 5).join(', ');
  return types ? `Discovered business categories: ${types}.` : undefined;
}

export function createLeadDiscoveryService(repository: OperationalRepository, runInTransaction: TransactionRunner) {
  return {
    async persistDiscovery(input: PersistLeadDiscoveryInput): Promise<PersistLeadDiscoveryResult> {
      const query = requireText(input.discovery.query, 'discovery.query');
      const actorId = requireText(input.actorId ?? 'lead_agent', 'actorId');
      const created: LeadRecord[] = [];
      const duplicates: Array<{ providerPlaceId: string; leadId: string }> = [];

      for (const candidate of input.discovery.candidates) {
        const providerPlaceId = requireText(candidate.providerPlaceId, 'candidate.providerPlaceId');
        const companyName = requireText(candidate.displayName, 'candidate.displayName');

        const outcome = await runInTransaction(async (tx) => {
          const existing = await tx.findLeadByGooglePlaceId(providerPlaceId);
          if (existing) return { kind: 'duplicate' as const, lead: existing };

          const lead = await tx.createLead({
            companyName,
            source: 'google_places',
            ...(candidateSummary(candidate) ? { opportunitySummary: candidateSummary(candidate) } : {}),
            evidence: [googlePlaceEvidence(providerPlaceId, query)],
          });

          await tx.createWorkflowEvent({
            eventType: 'lead_discovered',
            actorType: 'agent',
            actorId,
            payload: {
              leadId: lead.id,
              provider: 'google_places',
              providerPlaceId,
              query,
              evidenceReference: `google-places:place:${providerPlaceId}`,
            },
          });
          return { kind: 'created' as const, lead };
        });

        if (outcome.kind === 'duplicate') {
          duplicates.push({ providerPlaceId, leadId: outcome.lead.id });
        } else {
          created.push(outcome.lead);
        }
      }

      return { created, duplicates };
    },

    isGooglePlaceLead(lead: LeadRecord, providerPlaceId: string): boolean {
      return lead.source === 'google_places' && evidenceContainsGooglePlace(lead.evidence, providerPlaceId);
    },
  };
}

export type LeadDiscoveryService = ReturnType<typeof createLeadDiscoveryService>;
