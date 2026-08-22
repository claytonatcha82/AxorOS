import type {
  OperationsProductionReadinessDecision,
  OperationsProductionReadinessPostgresStore,
} from '../data/operations-production-readiness-postgres-store.js';

export interface OperationsProductionReadinessAssessment {
  readinessId: string;
  commercialRecordReference: string;
  contractSigned: boolean;
  onboardingComplete: boolean;
  assetsAvailable: boolean;
  planningComplete: boolean;
  evidenceReferences: string[];
  assessedAt: string;
}

export interface OperationsProductionReadinessWorkflowResult {
  persistence: 'accepted' | 'replayed';
  decision: OperationsProductionReadinessDecision;
}

export interface OperationsProductionReadinessWorkflowDependencies {
  readinessStore: Pick<OperationsProductionReadinessPostgresStore, 'save' | 'get'>;
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeEvidence(references: string[]): string[] {
  const normalized = references.map((reference) => reference.trim()).filter(Boolean);
  if (!normalized.length) throw new Error('Operations production readiness evidence is required.');
  return [...new Set(normalized)];
}

export function evaluateOperationsProductionReadiness(
  assessment: OperationsProductionReadinessAssessment,
): OperationsProductionReadinessDecision {
  const readinessId = requiredString(assessment.readinessId, 'Operations readiness ID');
  const commercialRecordReference = requiredString(
    assessment.commercialRecordReference,
    'Operations readiness commercial record',
  );
  if (Number.isNaN(Date.parse(assessment.assessedAt))) {
    throw new Error('Operations readiness assessment timestamp is invalid.');
  }

  const allPrerequisitesComplete = assessment.contractSigned
    && assessment.onboardingComplete
    && assessment.assetsAvailable
    && assessment.planningComplete;

  return {
    readinessId,
    commercialRecordReference,
    state: allPrerequisitesComplete ? 'OPERATIONS_READY' : 'OPERATIONS_BLOCKED',
    contractSigned: assessment.contractSigned,
    onboardingComplete: assessment.onboardingComplete,
    assetsAvailable: assessment.assetsAvailable,
    planningComplete: assessment.planningComplete,
    evidenceReferences: normalizeEvidence(assessment.evidenceReferences),
    approvedBy: 'operations_agent',
    approvedAt: new Date(assessment.assessedAt).toISOString(),
  };
}

export function createOperationsProductionReadinessWorkflow(
  dependencies: OperationsProductionReadinessWorkflowDependencies,
) {
  return {
    async assess(
      assessment: OperationsProductionReadinessAssessment,
    ): Promise<OperationsProductionReadinessWorkflowResult> {
      const decision = evaluateOperationsProductionReadiness(assessment);
      const persistence = await dependencies.readinessStore.save(decision);
      const persisted = await dependencies.readinessStore.get(decision.readinessId);
      if (!persisted) {
        throw new Error('Operations readiness record could not be reloaded after workflow persistence.');
      }
      return { persistence, decision: persisted };
    },
  };
}
