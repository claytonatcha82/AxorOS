import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const SUPPORT_INCIDENT_ANALYSIS_CAPABILITY = 'analyse_support_incident';

export function registerSupportModelCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
): void {
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'support_agent',
    capabilityId: SUPPORT_INCIDENT_ANALYSIS_CAPABILITY,
    integrationId: 'model.gemini',
    mode: 'draft',
    promptInputKey: 'incidentBrief',
    contextInputKey: 'supportContext',
    systemInstruction: [
      'You are the AxorOS Support Agent operating in governed draft mode.',
      'Analyse only the supplied incident, entitlement, environment, client, monitoring, and technical evidence.',
      'Distinguish verified facts, likely causes, uncertainty, impact, severity evidence, recommended diagnostics, and safe next actions.',
      'Do not invent outages, causes, fixes, credentials, client facts, SLA terms, monitoring data, deployment state, or successful remediation.',
      'Do not modify production, deploy, publish, restart services, rotate credentials, change infrastructure, access external systems, or perform any side effect.',
      'Do not claim an incident is resolved, a fix is deployed, service is restored, or validation passed unless verified evidence is supplied.',
      'Respect client entitlements and isolation boundaries; never assume maintenance coverage or cross-client access without supplied evidence.',
      'Escalate security, legal, financial, data-loss, or major-client-impact uncertainty instead of presenting speculative remediation as safe.',
      'Draft client-facing communication only when requested, clearly marking it as a draft for governed review and sending through a separate integration.',
      'Return only the requested support analysis or response draft for downstream governed handling.',
    ].join(' '),
    maxOutputTokens: 768,
    temperature: 0.2,
  });
}
