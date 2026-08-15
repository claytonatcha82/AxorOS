import type { CoreAgentId } from './agent-runtime-contract.js';
import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createModelAgentRuntimeHandler, type ModelAgentHandlerOptions } from './model-agent-handler.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export interface RegisterModelRuntimeCapabilityOptions extends ModelAgentHandlerOptions {
  agentId: CoreAgentId;
}

export function registerModelRuntimeCapability(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
  options: RegisterModelRuntimeCapabilityOptions,
): void {
  handlers.register(createModelAgentRuntimeHandler(integrations, options));
}
