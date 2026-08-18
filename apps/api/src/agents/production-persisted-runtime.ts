import type { Pool } from 'pg';
import { createAgentRuntimePostgresStore } from '../data/agent-runtime-postgres-store.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import { createProductionRuntimeBootstrap } from './production-runtime-bootstrap.js';
import { createProductionRuntimeCommandService } from './production-runtime-command-service.js';

export interface PersistedProductionRuntimeDependencies {
  pool: Pool;
  integrations: IntegrationRegistry;
}

export function createPersistedProductionRuntime(
  dependencies: PersistedProductionRuntimeDependencies,
) {
  const production = createProductionRuntimeBootstrap({
    pool: dependencies.pool,
    integrations: dependencies.integrations,
  });
  const store = createAgentRuntimePostgresStore(dependencies.pool);
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers: production.handlers,
  });
  const commands = createProductionRuntimeCommandService({ store, orchestrator });

  return {
    store,
    orchestrator,
    commands,
    handlers: production.handlers,
    financeClearanceStore: production.financeClearanceStore,
  };
}
