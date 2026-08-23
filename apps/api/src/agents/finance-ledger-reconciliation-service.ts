import type { FinanceLedgerPostgresStore } from '../data/finance-ledger-postgres-store.js';
import { reconcileFinanceLedger, type FinanceLedgerReconciliationResult } from './finance-ledger-reconciliation.js';

export interface FinanceLedgerReconciliationServiceDependencies {
  ledgerStore: Pick<FinanceLedgerPostgresStore, 'listByCommercialRecord'>;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function createFinanceLedgerReconciliationService(
  dependencies: FinanceLedgerReconciliationServiceDependencies,
) {
  return {
    async reconcile(commercialRecordReference: string): Promise<FinanceLedgerReconciliationResult> {
      const reference = required(commercialRecordReference, 'commercialRecordReference');
      const entries = await dependencies.ledgerStore.listByCommercialRecord(reference);
      return reconcileFinanceLedger(reference, entries);
    },
  };
}
