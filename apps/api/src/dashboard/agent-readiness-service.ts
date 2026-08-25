import type { CoreAgentId } from '../agents/agent-runtime-contract.js';

export type AgentReadinessStatus = 'READY' | 'NOT_CONFIGURED' | 'BLOCKED' | 'DEGRADED';

export interface AgentReadinessRecord {
  agentId: CoreAgentId;
  status: AgentReadinessStatus;
  requiredIntegrations: string[];
  missingIntegrations: string[];
  blockers: string[];
  notes: string[];
}

export interface AgentReadinessInputs {
  registeredIntegrationIds: readonly string[];
  controlPlaneConfigured: boolean;
  databaseConfigured: boolean;
  productionModelIntegrationId?: string;
  paymentIntegrationId?: string;
  paymentMode?: 'sandbox' | 'live';
}

const CORE_AGENTS: CoreAgentId[] = [
  'knowledge_agent', 'executive_agent', 'operations_agent', 'lead_agent', 'sales_agent',
  'production_agent', 'support_agent', 'marketing_agent', 'finance_agent',
];

function requiredIntegrations(agentId: CoreAgentId, input: AgentReadinessInputs): string[] {
  switch (agentId) {
    case 'lead_agent': return ['research.google-places', 'research.tavily-web'];
    case 'sales_agent': return ['email.gmail', 'model.openai'];
    case 'production_agent': return [input.productionModelIntegrationId ?? 'model.anthropic'];
    case 'support_agent': return ['email.gmail'];
    case 'marketing_agent': return ['model.gemini', 'email.gmail'];
    case 'finance_agent': return [input.paymentIntegrationId ?? 'payment.sandbox'];
    default: return [];
  }
}

export function createAgentReadinessService(input: AgentReadinessInputs) {
  const registered = new Set(input.registeredIntegrationIds);

  function assess(agentId: CoreAgentId): AgentReadinessRecord {
    const required = requiredIntegrations(agentId, input);
    const missing = required.filter((integrationId) => !registered.has(integrationId));
    const blockers: string[] = [];
    const notes: string[] = [];

    if (!input.databaseConfigured) blockers.push('Database is not configured.');
    if (!input.controlPlaneConfigured) blockers.push('Control-plane authentication is not configured.');
    if (missing.length > 0) blockers.push(`Missing required integration(s): ${missing.join(', ')}.`);

    if (agentId === 'finance_agent' && input.paymentMode === 'sandbox') {
      notes.push('Payment integration is configured in sandbox mode; live payments remain disabled.');
    }

    if (blockers.length > 0) {
      const configurationMissing = !input.databaseConfigured || !input.controlPlaneConfigured || missing.length > 0;
      return { agentId, status: configurationMissing ? 'NOT_CONFIGURED' : 'BLOCKED', requiredIntegrations: required, missingIntegrations: missing, blockers, notes };
    }

    return { agentId, status: notes.length > 0 ? 'DEGRADED' : 'READY', requiredIntegrations: required, missingIntegrations: [], blockers: [], notes };
  }

  return {
    snapshot(): AgentReadinessRecord[] {
      return CORE_AGENTS.map(assess);
    },
  };
}

export type AgentReadinessService = ReturnType<typeof createAgentReadinessService>;
