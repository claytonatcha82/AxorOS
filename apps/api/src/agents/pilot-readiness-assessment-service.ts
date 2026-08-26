import type { PilotActivationReadinessRecord } from '../data/pilot-activation-readiness-postgres-store.js';
import type {
  PilotVerificationCategory,
  PilotVerificationEvidenceRecord,
} from '../data/pilot-verification-evidence-postgres-store.js';

const REQUIRED_CATEGORIES: readonly PilotVerificationCategory[] = [
  'SYNTHETIC_LIFECYCLE',
  'PERSISTED_RUNTIME',
  'FINANCE_INTEGRITY',
  'CONTROL_PLANE',
  'DEPLOYMENT_SAFETY',
];

export interface PilotReadinessAssessmentDependencies {
  evidenceStore: {
    get(evidenceId: string): Promise<PilotVerificationEvidenceRecord | null>;
  };
  readinessStore: {
    save(record: PilotActivationReadinessRecord): Promise<'accepted' | 'replayed'>;
  };
}

export interface PilotReadinessAssessmentInput {
  readinessId: string;
  evidenceIds: readonly string[];
  assessedBy: string;
  assessedAt?: string;
}

export interface PilotReadinessAssessmentResult {
  state: 'PILOT_ACTIVATION_READY' | 'PILOT_ACTIVATION_BLOCKED';
  readinessId: string;
  evidence: readonly PilotVerificationEvidenceRecord[];
  persistence: 'accepted' | 'replayed';
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function createPilotReadinessAssessmentService(dependencies: PilotReadinessAssessmentDependencies) {
  return {
    async assess(input: PilotReadinessAssessmentInput): Promise<PilotReadinessAssessmentResult> {
      const readinessId = required(input.readinessId, 'readinessId');
      const assessedBy = required(input.assessedBy, 'assessedBy');
      const evidenceIds = input.evidenceIds.map((id) => required(id, 'evidenceId'));
      if (evidenceIds.length !== REQUIRED_CATEGORIES.length) {
        throw new Error(`Pilot readiness assessment requires exactly ${REQUIRED_CATEGORIES.length} evidence records.`);
      }
      if (new Set(evidenceIds).size !== evidenceIds.length) {
        throw new Error('Pilot readiness assessment evidence IDs must be unique.');
      }

      const evidence: PilotVerificationEvidenceRecord[] = [];
      for (const evidenceId of evidenceIds) {
        const record = await dependencies.evidenceStore.get(evidenceId);
        if (!record) throw new Error(`Pilot verification evidence ${evidenceId} was not found.`);
        evidence.push(record);
      }

      const categories = new Set(evidence.map((record) => record.category));
      for (const category of REQUIRED_CATEGORIES) {
        if (!categories.has(category)) throw new Error(`Pilot readiness assessment is missing ${category} evidence.`);
      }
      if (categories.size !== REQUIRED_CATEGORIES.length) {
        throw new Error('Pilot readiness assessment contains duplicate verification categories.');
      }

      const allPass = evidence.every((record) => record.outcome === 'PASS');
      const byCategory = new Map(evidence.map((record) => [record.category, record] as const));
      const record: PilotActivationReadinessRecord = {
        readinessId,
        state: allPass ? 'PILOT_ACTIVATION_READY' : 'PILOT_ACTIVATION_BLOCKED',
        syntheticLifecycleVerified: byCategory.get('SYNTHETIC_LIFECYCLE')?.outcome === 'PASS',
        persistedRuntimeVerified: byCategory.get('PERSISTED_RUNTIME')?.outcome === 'PASS',
        financeIntegrityVerified: byCategory.get('FINANCE_INTEGRITY')?.outcome === 'PASS',
        controlPlaneVerified: byCategory.get('CONTROL_PLANE')?.outcome === 'PASS',
        deploymentSafetyVerified: byCategory.get('DEPLOYMENT_SAFETY')?.outcome === 'PASS',
        evidenceReferences: evidence.map((item) => `pilot-verification:${item.evidenceId}`),
        assessedBy,
        assessedAt: input.assessedAt ?? new Date().toISOString(),
      };

      const persistence = await dependencies.readinessStore.save(record);
      return { state: record.state, readinessId, evidence, persistence };
    },
  };
}
