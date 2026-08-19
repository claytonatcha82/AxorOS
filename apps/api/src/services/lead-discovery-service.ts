import type { LeadBusinessSearchOutput } from '../integrations/lead-research-integration.js';
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

function internalDiscoveryLabel(providerPlaceId: string): string {
  return `Google Place ${providerPlaceId}`;
}

function googlePlaceEvidence(providerPlaceId: string) {
  return {
    kind: 'lead_discovery',
    provider: 'google_places',
    providerPlaceId,
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

export function createLeadDiscoveryService(repository: OperationalRepository, runInTransaction: TransactionRunner) {
  return {
    async persistDiscovery(input: PersistLeadDiscoveryInput): Promise<PersistLeadDiscoveryResult> {
      requireText(input.discovery.query, 'discovery.query');
      const actorId = requireText(input.actorId ?? 'lead_agent', 'actorId');
      const created: LeadRecord[] = [];
      const duplicates: Array<{ providerPlaceId: string; leadId: string }> = [];

      for (const candidate of input.discovery.candidates) {
        const providerPlaceId = requireText(candidate.providerPlaceId, 'candidate.providerPlaceId');

        const outcome = await runInTransaction(async (tx) => {
          // Serialize workers competing for the same provider identity. The database
          // primary key remains the final uniqueness boundary.
          await tx.lockLeadSourceIdentity('google_places', providerPlaceId);

          const identity = await tx.findLeadSourceIdentity('google_places', providerPlaceId);
          if (identity) {
            const existing = await tx.getLeadById(identity.leadId);
            if (!existing) throw new Error(`Lead source identity ${providerPlaceId} references a missing lead.`);
            return { kind: 'duplicate' as const, lead: existing };
          }

          // Backward-compatibility path for pre-migration discovery records. If one
          // exists, claim it in the normalized identity table rather than duplicating it.
          const legacy = await tx.findLeadByGooglePlaceId(providerPlaceId);
          if (legacy) {
            await tx.createLeadSourceIdentity('google_places', providerPlaceId, legacy.id);
            return { kind: 'duplicate' as const, lead: legacy };
          }

          const lead = await tx.createLead({
            companyName: internalDiscoveryLabel(providerPlaceId),
            source: 'google_places',
            evidence: [googlePlaceEvidence(providerPlaceId)],
          });
          await tx.createLeadSourceIdentity('google_places', providerPlaceId, lead.id);

          await tx.createWorkflowEvent({
            eventType: 'lead_discovered',
            actorType: 'agent',
            actorId,
            payload: {
              leadId: lead.id,
              provider: 'google_places',
              providerPlaceId,
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
