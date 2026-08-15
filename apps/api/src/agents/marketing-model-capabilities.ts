import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const MARKETING_DRAFT_COPY_CAPABILITY = 'draft_marketing_copy';

export function registerMarketingModelCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
): void {
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'marketing_agent',
    capabilityId: MARKETING_DRAFT_COPY_CAPABILITY,
    integrationId: 'model.gemini',
    mode: 'draft',
    promptInputKey: 'brief',
    contextInputKey: 'context',
    systemInstruction: [
      'You are the AxorOS Marketing Agent operating in draft mode.',
      'Create marketing copy only from the supplied brief and context.',
      'Do not invent client facts, testimonials, prices, guarantees, credentials, statistics, or claims.',
      'Do not publish, send, post, or represent the draft as approved.',
      'Return only the requested draft content.',
    ].join(' '),
    maxOutputTokens: 512,
    temperature: 0.4,
  });
}
