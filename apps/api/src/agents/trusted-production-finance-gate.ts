import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';

function requiredContextString(task: AgentRuntimeTask, key: string): string {
  const value = task.context[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Production start blocked: trusted ${key} is required.`);
  }
  return value.trim();
}

export async function assertTrustedProductionFinanceGate(
  task: AgentRuntimeTask,
  clearanceStore: Pick<FinanceClearancePostgresStore, 'get'>,
  paymentStateStore: Pick<FinancePaymentCurrentStatePostgresStore, 'get'>,
): Promise<void> {
  if (task.destinationAgent !== 'production_agent') return;

  const clearanceId = requiredContextString(task, 'financeClearanceId');
  const commercialRecordReference = requiredContextString(task, 'commercialRecordReference');
  const persisted = await clearanceStore.get(clearanceId);

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

  const providerEvidence = persisted.evidenceReferences.find((reference) => reference.startsWith('payment-provider:'));
  if (!providerEvidence) {
    throw new Error('Production start blocked: Finance clearance lacks trusted payment-provider evidence.');
  }
  const provider = providerEvidence.slice('payment-provider:'.length).split(':', 1)[0];
  if (!provider) {
    throw new Error('Production start blocked: Finance clearance payment provider could not be resolved.');
  }

  const current = await paymentStateStore.get(provider, persisted.providerPaymentReference);
  if (!current) throw new Error('Production start blocked: authoritative current payment state was not found.');
  if (current.commercialRecordReference !== persisted.commercialRecordReference) {
    throw new Error('Production start blocked: current payment state does not match the commercial record.');
  }
  if (current.authorityState !== 'AUTHORIZED' || current.paymentStatus !== 'CONFIRMED') {
    throw new Error(`Production start blocked: current payment authority is ${current.authorityState} with status ${current.paymentStatus}.`);
  }
  if (current.amountMinor !== undefined && current.amountMinor !== persisted.amountMinor) {
    throw new Error('Production start blocked: current payment amount does not match the Finance clearance.');
  }
  if (current.currency !== undefined && current.currency !== persisted.currency) {
    throw new Error('Production start blocked: current payment currency does not match the Finance clearance.');
  }
}
