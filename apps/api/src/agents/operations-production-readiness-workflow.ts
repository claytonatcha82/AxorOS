import type {
  OperationsProductionReadinessDecision,
  OperationsProductionReadinessPostgresStore,
} from '../data/operations-production-readiness-postgres-store.js';
import type {
  OperationsProductionPrerequisiteEvidence,
  OperationsProductionPrerequisiteEvidenceResolver,
} from './operations-production-prerequisite-evidence.js';

export interface OperationsProductionReadinessAssessment {
  readinessId: string;
  commercialRecordReference: string;
  assessedAt: string;
}

export interface OperationsProductionReadinessWorkflowResult {
  persistence: 'accepted' | 'replayed';
  decision: OperationsProductionReadinessDecision;
}

export interface OperationsProductionReadinessWorkflowDependencies {
  readinessStore: Pick<OperationsProductionReadinessPostgresStore, 'save' | 'get'>;
  prerequisiteEvidenceResolver: Pick<OperationsProductionPrerequisiteEvidenceResolver, 'resolve'>;
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
  prerequisites: OperationsProductionPrerequisiteEvidence,
): OperationsProductionReadinessDecision {
  const readinessId = requiredString(assessment.readinessId, 'Operations readiness ID');
  const commercialRecordReference = requiredString(
    assessment.commercialRecordReference,
    'Operations readiness commercial record',
  );
  if (Number.isNaN(Date.parse(assessment.assessedAt))) {
    throw new Error('Operations readiness assessment timestamp is invalid.');
  }
  if (prerequisites.commercialRecordReference !== commercialRecordReference) {
    throw new Error('Operations prerequisite evidence does not belong to the requested commercial record.');
  }

  const allPrerequisitesComplete = prerequisites.contractSigned
    && prerequisites.onboardingComplete
    && prerequisites.assetsAvailable
    && prerequisites.planningComplete;

  return {
    readinessId,
    commercialRecordReference,
    state: allPrerequisitesComplete ? 'OPERATIONS_READY' : 'OPERATIONS_BLOCKED',
    contractSigned: prerequisites.contractSigned,
    onboardingComplete: prerequisites.onboardingComplete,
    assetsAvailable: prerequisites.assetsAvailable,
    planningComplete: prerequisites.planningComplete,
    evidenceReferences: normalizeEvidence(prerequisites.evidenceReferences),
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
      const commercialRecordReference = requiredString(
        assessment.commercialRecordReference,
        'Operations readiness commercial record',
      );
      const prerequisites = await dependencies.prerequisiteEvidenceResolver.resolve(
        commercialRecordReference,
      );
      const decision = evaluateOperationsProductionReadiness(
        { ...assessment, commercialRecordReference },
        prerequisites,
      );
      const persistence = await dependencies.readinessStore.save(decision);
      const persisted = await dependencies.readinessStore.get(decision.readinessId);
      if (!persisted) {
        throw new Error('Operations readiness record could not be reloaded after workflow persistence.');
      }
      return { persistence, decision: persisted };
    },
  };
}
