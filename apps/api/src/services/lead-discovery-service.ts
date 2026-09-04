import type { LeadBusinessSearchOutput } from '../integrations/lead-research-integration.js';
import type { LeadRecord, OperationalRepository } from '../data/operational-repository.js';
import type { TransactionRunner } from '../data/transaction.js';

export interface PersistLeadDiscoveryInput {
  discovery: LeadBusinessSearchOutput;
  actorId?: string;
}

export interface PersistLeadDiscoveryResult {
  created: LeadRecord[];
  duplicates: Array<{ providerPlaceId: string; leadId: string; enrichmentPending: boolean }>;
  skipped: Array<{ providerPlaceId: string; reason: string }>;
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

const GOOGLE_PLACE_ID_PATTERN = /^ChIJ[A-Za-z0-9_-]+$/;

export function canonicalizeGooglePlacesBusinessName(value: string): string {
  let name = value.trim().replace(/\s+/g, ' ');
  name = name.replace(/^(?:contact\s+(?:our|the)\s+office|contact\s+us|home|welcome)\s*[-–—:|]\s*/i, '');
  name = name.replace(/\s*[-–—:|]\s*(?:home|contact\s+us|contact\s+(?:our|the)\s+office)\s*$/i, '');
  name = name.replace(/^Google Place\s+/i, '');
  name = name.trim();
  if (GOOGLE_PLACE_ID_PATTERN.test(name)) return '';
  if (!name || name.toLowerCase() === 'google place') return '';
  return name;
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
      const duplicates: Array<{ providerPlaceId: string; leadId: string; enrichmentPending: boolean }> = [];
      const skipped: Array<{ providerPlaceId: string; reason: string }> = [];

      for (const candidate of input.discovery.candidates) {
        const providerPlaceId = requireText(candidate.providerPlaceId, 'candidate.providerPlaceId');
        const displayName = requireText(candidate.displayName, 'candidate.displayName');
        const canonicalName = canonicalizeGooglePlacesBusinessName(displayName);

        if (!canonicalName || GOOGLE_PLACE_ID_PATTERN.test(canonicalName)) {
          skipped.push({
            providerPlaceId,
            reason: 'Unusable displayName: provider ID fallback or empty after canonicalization.',
          });
          continue;
        }
        const companyName = requireText(canonicalName, 'candidate.displayName');

        const outcome = await runInTransaction(async (tx) => {
          await tx.lockLeadSourceIdentity('google_places', providerPlaceId);

          const identity = await tx.findLeadSourceIdentity('google_places', providerPlaceId);
          if (identity) {
            const existing = await tx.getLeadById(identity.leadId);
            if (!existing) throw new Error(`Lead source identity ${providerPlaceId} references a missing lead.`);
            return { kind: 'duplicate' as const, lead: existing };
          }

          const legacy = await tx.findLeadByGooglePlaceId(providerPlaceId);
          if (legacy) {
            await tx.createLeadSourceIdentity('google_places', providerPlaceId, legacy.id);
            return { kind: 'duplicate' as const, lead: legacy };
          }

          const lead = await tx.createLead({
            companyName,
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
          duplicates.push({
            providerPlaceId,
            leadId: outcome.lead.id,
            enrichmentPending: outcome.lead.enrichmentStatus === 'pending',
          });
        } else {
          created.push(outcome.lead);
        }
      }

      return { created, duplicates, skipped };
    },

    isGooglePlaceLead(lead: LeadRecord, providerPlaceId: string): boolean {
      return lead.source === 'google_places' && evidenceContainsGooglePlace(lead.evidence, providerPlaceId);
    },
  };
}

export type LeadDiscoveryService = ReturnType<typeof createLeadDiscoveryService>;
