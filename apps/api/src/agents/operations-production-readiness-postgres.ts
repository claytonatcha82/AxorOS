import type { Pool } from 'pg';
import { OperationsProductionReadinessPostgresStore } from '../data/operations-production-readiness-postgres-store.js';
import { createOperationsProductionPrerequisiteEvidenceResolver } from './operations-production-prerequisite-evidence.js';
import {
  createOperationsProductionReadinessWorkflow,
  type OperationsProductionReadinessAssessment,
  type OperationsProductionReadinessWorkflowResult,
} from './operations-production-readiness-workflow.js';

export interface OperationsProductionReadinessPostgresDependencies {
  pool: Pick<Pool, 'query'>;
}

export function createOperationsProductionReadinessPostgresService(
  dependencies: OperationsProductionReadinessPostgresDependencies,
) {
  const readinessStore = new OperationsProductionReadinessPostgresStore(dependencies.pool);
  const prerequisiteEvidenceResolver = createOperationsProductionPrerequisiteEvidenceResolver(dependencies);
  const workflow = createOperationsProductionReadinessWorkflow({
    readinessStore,
    prerequisiteEvidenceResolver,
  });

  return {
    readinessStore,
    prerequisiteEvidenceResolver,
    async assess(
      assessment: OperationsProductionReadinessAssessment,
    ): Promise<OperationsProductionReadinessWorkflowResult> {
      return workflow.assess(assessment);
    },
  };
}
