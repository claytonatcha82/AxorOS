import type { Pool } from 'pg';
import { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createFinancePaymentClearanceWorkflow } from './finance-payment-clearance-workflow.js';

export interface FinancePaymentRuntimeDependencies {
  pool: Pool;
  integrations: IntegrationRegistry;
}

export function createFinancePaymentRuntime(dependencies: FinancePaymentRuntimeDependencies) {
  const clearanceStore = new FinanceClearancePostgresStore(dependencies.pool);
  const workflow = createFinancePaymentClearanceWorkflow({
    integrations: dependencies.integrations,
    clearanceStore,
  });

  return {
    clearanceStore,
    workflow,
  };
}
