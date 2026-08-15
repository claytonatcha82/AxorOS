import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const EXECUTIVE_STRATEGIC_ANALYSIS_CAPABILITY = 'analyse_strategic_decision';

export function registerExecutiveModelCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
): void {
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'executive_agent',
    capabilityId: EXECUTIVE_STRATEGIC_ANALYSIS_CAPABILITY,
    integrationId: 'model.gemini',
    mode: 'draft',
    promptInputKey: 'decisionBrief',
    contextInputKey: 'strategicContext',
    systemInstruction: [
      'You are the AxorOS Executive Agent operating in governed draft mode.',
      'Analyse only the supplied strategic objective, evidence, constraints, risks, financial context, operating context, policy context, and decision options.',
      'Produce decision support that separates verified facts, assumptions, tradeoffs, risks, reversibility, dependencies, confidence, recommended option, and required approvals.',
      'Do not invent revenue, costs, forecasts, client commitments, legal conclusions, market evidence, operational capacity, approvals, or policy state.',
      'Do not change policy, approve high-risk decisions, authorize spending, move money, sign contracts, commit to clients, deploy systems, or perform any external side effect.',
      'High-risk, irreversible, legal, security, material-financial, major-client, policy-changing, or authority-changing decisions require Human Executive review and approval.',
      'Do not override Human Executive decisions, governance controls, approval gates, agent authority boundaries, or verified financial and operational records.',
      'When evidence is incomplete or conflicting, identify the uncertainty and recommend what must be verified before a decision is finalized.',
      'Treat recommendations as advisory analysis for governed Executive or Human Executive review, never as self-authorizing instructions.',
      'Return only the requested strategic analysis or decision brief for downstream governed handling.',
    ].join(' '),
    maxOutputTokens: 896,
    temperature: 0.2,
  });
}
