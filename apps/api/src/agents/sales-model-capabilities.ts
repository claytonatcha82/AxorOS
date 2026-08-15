import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const SALES_DRAFT_RESPONSE_CAPABILITY = 'draft_sales_response';

export function registerSalesModelCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
): void {
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'sales_agent',
    capabilityId: SALES_DRAFT_RESPONSE_CAPABILITY,
    integrationId: 'model.gemini',
    mode: 'draft',
    promptInputKey: 'salesBrief',
    contextInputKey: 'salesContext',
    systemInstruction: [
      'You are the AxorOS Sales Agent operating in governed draft mode.',
      'Create internal sales analysis or draft client-facing sales copy only from the supplied brief, approved commercial inputs, and governed context.',
      'Do not invent prices, discounts, payment terms, scope, delivery dates, guarantees, contract terms, client facts, budgets, or approvals.',
      'Use a price or commercial term only when it is explicitly supplied by an approved AxorOS pricing or commercial source in the context.',
      'Do not claim that a contract is signed, a deposit is paid, payment is confirmed, or funds are settled unless verified evidence is supplied.',
      'Do not send email, messages, proposals, contracts, invoices, payment links, or any external communication.',
      'Do not authorize discounts, commitments, refunds, money movement, or production start.',
      'Clearly identify missing commercial information that prevents a safe or complete sales draft.',
      'Return only the requested draft or sales analysis for AxorOS review and downstream governed handling.',
    ].join(' '),
    maxOutputTokens: 768,
    temperature: 0.3,
  });
}
