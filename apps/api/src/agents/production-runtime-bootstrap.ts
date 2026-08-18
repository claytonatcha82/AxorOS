import type { Pool } from 'pg';
import { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import {
  PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
  registerProductionModelCapabilities,
} from './production-model-capabilities.js';

export interface ProductionRuntimeBootstrapDependencies {
  pool: Pick<Pool, 'query'>;
  integrations: IntegrationRegistry;
}

export interface ProductionRuntimeBootstrapResult {
  handlers: AgentRuntimeHandlerRegistry;
  financeClearanceStore: FinanceClearancePostgresStore;
  financePaymentStateStore: FinancePaymentCurrentStatePostgresStore;
  commercialPaymentRequirementStore: CommercialPaymentRequirementPostgresStore;
}

export function createProductionRuntimeBootstrap(
  dependencies: ProductionRuntimeBootstrapDependencies,
): ProductionRuntimeBootstrapResult {
  const handlers = new AgentRuntimeHandlerRegistry();
  const financeClearanceStore = new FinanceClearancePostgresStore(dependencies.pool);
  const financePaymentStateStore = new FinancePaymentCurrentStatePostgresStore(dependencies.pool);
  const commercialPaymentRequirementStore = new CommercialPaymentRequirementPostgresStore(dependencies.pool);

  registerProductionModelCapabilities(
    handlers,
    dependencies.integrations,
    financeClearanceStore,
    financePaymentStateStore,
    commercialPaymentRequirementStore,
  );

  handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);

  return {
    handlers,
    financeClearanceStore,
    financePaymentStateStore,
    commercialPaymentRequirementStore,
  };
}
