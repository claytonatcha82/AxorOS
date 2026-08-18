import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';

function requiredContextString(task: AgentRuntimeTask, key: string): string {
  const value = task.context[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Production start blocked: trusted ${key} is required.`);
  }
  return value.trim();
}

export async function assertTrustedProductionFinanceGate(
  task: AgentRuntimeTask,
  store: Pick<FinanceClearancePostgresStore, 'get'>,
): Promise<void> {
  if (task.destinationAgent !== 'production_agent') return;

  const clearanceId = requiredContextString(task, 'financeClearanceId');
  const commercialRecordReference = requiredContextString(task, 'commercialRecordReference');
  const persisted = await store.get(clearanceId);

  if (!persisted) throw new Error('Production start blocked: trusted Finance clearance record was not found.');
  if (persisted.state !== 'FINANCE_CLEARED') throw new Error('Production start blocked: persisted Finance clearance is not FINANCE_CLEARED.');
  if (persisted.commercialRecordReference !== commercialRecordReference) {
    throw new Error('Production start blocked: Finance clearance does not match the commercial record.');
  }
  if (!persisted.evidenceReferences.length) {
    throw new Error('Production start blocked: persisted Finance clearance has no provider evidence.');
  }
  if (!Number.isSafeInteger(persisted.amountMinor) || persisted.amountMinor <= 0) {
    throw new Error('Production start blocked: persisted Finance clearance amount is invalid.');
  }
  if (!/^[A-Z]{3}$/.test(persisted.currency)) {
    throw new Error('Production start blocked: persisted Finance clearance currency is invalid.');
  }
  if (Number.isNaN(Date.parse(persisted.verifiedAt))) {
    throw new Error('Production start blocked: persisted Finance clearance timestamp is invalid.');
  }
}
