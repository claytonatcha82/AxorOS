import type { Pool } from 'pg';
import { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import { OperationsProductionReadinessPostgresStore } from '../data/operations-production-readiness-postgres-store.js';
import { ProductionDeploymentAuthorityPostgresStore } from '../data/production-deployment-authority-postgres-store.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerPilotRuntimeCapabilities } from './pilot-runtime-capabilities.js';
import {
  DEFAULT_PRODUCTION_MODEL_POLICY,
  type ProductionModelPolicy,
} from './production-model-policy.js';
import { PRODUCTION_PROJECT_PLAN_CAPABILITY } from './production-project-plan-capability.js';
import {
  PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
  registerProductionModelCapabilities,
} from './production-model-capabilities.js';

export interface ProductionRuntimeBootstrapDependencies {
  pool: Pick<Pool, 'query'>;
  integrations: IntegrationRegistry;
  modelPolicy?: ProductionModelPolicy;
}

export interface ProductionRuntimeBootstrapResult {
  handlers: AgentRuntimeHandlerRegistry;
  financeClearanceStore: FinanceClearancePostgresStore;
  financePaymentStateStore: FinancePaymentCurrentStatePostgresStore;
  commercialPaymentRequirementStore: CommercialPaymentRequirementPostgresStore;
  commercialPaymentSatisfactionStore: CommercialPaymentSatisfactionPostgresStore;
  operationsReadinessStore: OperationsProductionReadinessPostgresStore;
  deploymentAuthorityStore: ProductionDeploymentAuthorityPostgresStore;
}

export function createProductionRuntimeBootstrap(
  dependencies: ProductionRuntimeBootstrapDependencies,
): ProductionRuntimeBootstrapResult {
  const handlers = new AgentRuntimeHandlerRegistry();
  const financeClearanceStore = new FinanceClearancePostgresStore(dependencies.pool);
  const financePaymentStateStore = new FinancePaymentCurrentStatePostgresStore(dependencies.pool);
  const commercialPaymentRequirementStore = new CommercialPaymentRequirementPostgresStore(dependencies.pool);
  const commercialPaymentSatisfactionStore = new CommercialPaymentSatisfactionPostgresStore(dependencies.pool);
  const operationsReadinessStore = new OperationsProductionReadinessPostgresStore(dependencies.pool);
  const deploymentAuthorityStore = new ProductionDeploymentAuthorityPostgresStore(dependencies.pool);

  registerProductionModelCapabilities(
    handlers,
    dependencies.integrations,
    financeClearanceStore,
    financePaymentStateStore,
    commercialPaymentRequirementStore,
    commercialPaymentSatisfactionStore,
    operationsReadinessStore,
    dependencies.pool,
    dependencies.modelPolicy ?? DEFAULT_PRODUCTION_MODEL_POLICY,
  );
  registerPilotRuntimeCapabilities(handlers, dependencies.integrations);

  handlers.require('production_agent', PRODUCTION_PROJECT_PLAN_CAPABILITY);
  handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);

  return {
    handlers,
    financeClearanceStore,
    financePaymentStateStore,
    commercialPaymentRequirementStore,
    commercialPaymentSatisfactionStore,
    operationsReadinessStore,
    deploymentAuthorityStore,
  };
}
