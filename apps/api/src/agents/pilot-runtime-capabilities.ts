import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerExecutiveModelCapabilities } from './executive-model-capabilities.js';
import { registerKnowledgeModelCapabilities } from './knowledge-model-capabilities.js';
import { registerMarketingEmailCapabilities } from './marketing-email-capabilities.js';
import { registerMarketingModelCapabilities } from './marketing-model-capabilities.js';
import { registerOperationsEmailCapabilities } from './operations-email-capabilities.js';
import { registerOperationsModelCapabilities } from './operations-model-capabilities.js';
import { registerSupportEmailCapabilities } from './support-email-capabilities.js';
import { registerSupportModelCapabilities } from './support-model-capabilities.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export interface PilotRuntimeCapabilityOptions {
  geminiEnabled: boolean;
  gmailEnabled: boolean;
}

export function registerPilotRuntimeCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
  options: PilotRuntimeCapabilityOptions,
): void {
  if (options.geminiEnabled) {
    registerSupportModelCapabilities(handlers, integrations);
    registerMarketingModelCapabilities(handlers, integrations);
    registerOperationsModelCapabilities(handlers, integrations);
    registerKnowledgeModelCapabilities(handlers, integrations);
    registerExecutiveModelCapabilities(handlers, integrations);
  }

  if (options.gmailEnabled) {
    registerSupportEmailCapabilities(handlers, integrations, { integrationId: 'email.gmail' });
    registerMarketingEmailCapabilities(handlers, integrations, { integrationId: 'email.gmail' });
    registerOperationsEmailCapabilities(handlers, integrations, { integrationId: 'email.gmail' });
  }
}
