import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { OperationsProductionReadinessPostgresStore } from '../data/operations-production-readiness-postgres-store.js';

export type OperationsProductionReadinessReader = Pick<OperationsProductionReadinessPostgresStore, 'get'>;

function requiredContextString(task: AgentRuntimeTask, key: string): string {
  const value = task.context[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Production start blocked: trusted ${key} is required.`);
  }
  return value.trim();
}

export async function assertPersistedOperationsReady(
  readinessStore: OperationsProductionReadinessReader | undefined,
  readinessId: string,
  commercialRecordReference: string,
): Promise<void> {
  if (!readinessStore) {
    throw new Error('Production start blocked: Operations readiness persistence is unavailable.');
  }
  if (!readinessId.trim()) {
    throw new Error('Production start blocked: trusted operationsReadinessId is required.');
  }
  if (!commercialRecordReference.trim()) {
    throw new Error('Production start blocked: trusted commercialRecordReference is required.');
  }

  const readiness = await readinessStore.get(readinessId.trim());
  if (!readiness) throw new Error('Production start blocked: trusted Operations readiness record was not found.');
  if (readiness.state !== 'OPERATIONS_READY') {
    throw new Error(`Production start blocked: Operations readiness state is ${readiness.state}.`);
  }
  if (readiness.commercialRecordReference !== commercialRecordReference.trim()) {
    throw new Error('Production start blocked: Operations readiness does not match the commercial record.');
  }
  if (!readiness.contractSigned || !readiness.onboardingComplete || !readiness.assetsAvailable || !readiness.planningComplete) {
    throw new Error('Production start blocked: Operations prerequisites are incomplete.');
  }
  if (!readiness.evidenceReferences.length) {
    throw new Error('Production start blocked: Operations readiness has no governed evidence.');
  }
  if (!readiness.approvedBy.trim()) {
    throw new Error('Production start blocked: Operations readiness approver is invalid.');
  }
  if (Number.isNaN(Date.parse(readiness.approvedAt))) {
    throw new Error('Production start blocked: Operations readiness timestamp is invalid.');
  }
}

export async function assertTrustedProductionOperationsGate(
  task: AgentRuntimeTask,
  readinessStore: OperationsProductionReadinessReader | undefined,
): Promise<void> {
  if (task.destinationAgent !== 'production_agent') return;
  const readinessId = requiredContextString(task, 'operationsReadinessId');
  const commercialRecordReference = requiredContextString(task, 'commercialRecordReference');
  await assertPersistedOperationsReady(readinessStore, readinessId, commercialRecordReference);
}
