import type { Pool } from 'pg';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import { createAgentRuntimePostgresStore } from '../data/agent-runtime-postgres-store.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createExactSourceContextService } from '../knowledge/exact-source-context-service.js';
import { createMarketingAtlasContextService } from '../services/marketing-atlas-context-service.js';
import { registerMarketingModelCapabilities } from './marketing-model-capabilities.js';
import { registerMarketingEmailCapabilities } from './marketing-email-capabilities.js';
import { createMarketingRuntimeCommandService } from './marketing-runtime-command-service.js';

export interface PersistedMarketingRuntimeDependencies {
  pool: Pool;
  integrations: IntegrationRegistry;
}

export function createPersistedMarketingRuntime(dependencies: PersistedMarketingRuntimeDependencies) {
  const handlers = new AgentRuntimeHandlerRegistry();
  registerMarketingModelCapabilities(handlers, dependencies.integrations);
  registerMarketingEmailCapabilities(handlers, dependencies.integrations, { integrationId: 'email.gmail' });

  const store = createAgentRuntimePostgresStore(dependencies.pool);
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const exactSourceContext = createExactSourceContextService(dependencies.pool);
  const atlas = createMarketingAtlasContextService(exactSourceContext);
  const commands = createMarketingRuntimeCommandService({ store, orchestrator, atlas });

  return { handlers, store, orchestrator, atlas, commands };
}

export type PersistedMarketingRuntime = ReturnType<typeof createPersistedMarketingRuntime>;
