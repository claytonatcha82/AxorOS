import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES } from './operations-production-prerequisite-evidence.js';

export type OperationsProductionPrerequisiteKey = keyof typeof OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES;

export interface OperationsProductionPrerequisiteRecordCommand {
  commercialRecordReference: string;
  prerequisite: OperationsProductionPrerequisiteKey;
  evidenceReference: string;
  observedAt: string;
}

export interface OperationsProductionPrerequisiteRecorderDependencies {
  record(input: {
    eventType: string;
    commercialRecordReference: string;
    evidenceReference: string;
    observedAt: string;
  }): Promise<WorkflowEventRecord>;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function createOperationsProductionPrerequisiteRecorder(
  dependencies: OperationsProductionPrerequisiteRecorderDependencies,
) {
  return {
    async record(command: OperationsProductionPrerequisiteRecordCommand): Promise<WorkflowEventRecord> {
      const commercialRecordReference = required(
        command.commercialRecordReference,
        'Operations prerequisite commercial record',
      );
      const evidenceReference = required(command.evidenceReference, 'Operations prerequisite evidence reference');
      if (!(command.prerequisite in OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES)) {
        throw new Error('Operations production prerequisite is invalid.');
      }
      if (Number.isNaN(Date.parse(command.observedAt))) {
        throw new Error('Operations prerequisite observation timestamp is invalid.');
      }

      return dependencies.record({
        eventType: OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES[command.prerequisite],
        commercialRecordReference,
        evidenceReference,
        observedAt: new Date(command.observedAt).toISOString(),
      });
    },
  };
}

export type OperationsProductionPrerequisiteRecorder = ReturnType<
  typeof createOperationsProductionPrerequisiteRecorder
>;
