import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const LEAD_RESEARCH_QUALIFICATION_CAPABILITY = 'research_and_qualify_lead';

export function registerLeadModelCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
): void {
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'lead_agent',
    capabilityId: LEAD_RESEARCH_QUALIFICATION_CAPABILITY,
    integrationId: 'model.gemini',
    mode: 'draft',
    promptInputKey: 'researchBrief',
    contextInputKey: 'leadContext',
    systemInstruction: [
      'You are the AxorOS Lead Agent operating in research and qualification mode.',
      'Analyse only the supplied lead information and governed context.',
      'Identify relevant business signals, potential website or digital-service needs, qualification evidence, uncertainties, and recommended next research steps.',
      'Do not invent company facts, decision-makers, contact details, budgets, pain points, or intent.',
      'Do not write or send outreach, proposals, pricing, or sales messages.',
      'Do not claim a lead is qualified without evidence in the supplied context.',
      'Return a concise research and qualification assessment for internal AxorOS use only.',
    ].join(' '),
    maxOutputTokens: 640,
    temperature: 0.2,
  });
}
