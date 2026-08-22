import type { Pool } from 'pg';

export const OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES = {
  contractSigned: 'operations_contract_signed_verified',
  onboardingComplete: 'operations_onboarding_complete',
  assetsAvailable: 'operations_assets_available',
  planningComplete: 'operations_planning_complete',
} as const;

export interface OperationsProductionPrerequisiteEvidence {
  commercialRecordReference: string;
  contractSigned: boolean;
  onboardingComplete: boolean;
  assetsAvailable: boolean;
  planningComplete: boolean;
  evidenceReferences: string[];
}

export interface OperationsProductionPrerequisiteEvidenceDependencies {
  pool: Pick<Pool, 'query'>;
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function createOperationsProductionPrerequisiteEvidenceResolver(
  dependencies: OperationsProductionPrerequisiteEvidenceDependencies,
) {
  return {
    async resolve(commercialRecordReference: string): Promise<OperationsProductionPrerequisiteEvidence> {
      const normalizedCommercialRecordReference = requiredString(
        commercialRecordReference,
        'Operations prerequisite commercial record',
      );
      const eventTypes = Object.values(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES);
      const result = await dependencies.pool.query(
        `select id, event_type, actor_type, actor_id, payload
           from operational.workflow_events
          where event_type = any($1::text[])
            and payload ->> 'commercialRecordReference' = $2
          order by created_at asc, id asc`,
        [eventTypes, normalizedCommercialRecordReference],
      );

      const verifiedEventTypes = new Set<string>();
      const evidenceReferences: string[] = [];

      for (const rawRow of result.rows) {
        const row = rawRow as Record<string, unknown>;
        if (row.actor_type !== 'agent' || row.actor_id !== 'operations_agent') continue;
        const eventType = String(row.event_type);
        if (!eventTypes.includes(eventType as (typeof eventTypes)[number])) continue;
        const payload = row.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
        const record = payload as Record<string, unknown>;
        if (record.verified !== true) continue;
        verifiedEventTypes.add(eventType);
        evidenceReferences.push(`workflow-event:${String(row.id)}`);
      }

      return {
        commercialRecordReference: normalizedCommercialRecordReference,
        contractSigned: verifiedEventTypes.has(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.contractSigned),
        onboardingComplete: verifiedEventTypes.has(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.onboardingComplete),
        assetsAvailable: verifiedEventTypes.has(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.assetsAvailable),
        planningComplete: verifiedEventTypes.has(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.planningComplete),
        evidenceReferences,
      };
    },
  };
}

export type OperationsProductionPrerequisiteEvidenceResolver = ReturnType<
  typeof createOperationsProductionPrerequisiteEvidenceResolver
>;
