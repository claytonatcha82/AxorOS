import type { CoreAgentId } from '../agents/agent-runtime-contract.js';

export type EmailIdentityId = 'sales' | 'support' | 'finance' | 'marketing' | 'operations';

export interface EmailIdentityDefinition {
  identityId: EmailIdentityId;
  displayName: string;
  allowedAgents: readonly CoreAgentId[];
  externalUse: boolean;
}

export const EMAIL_IDENTITIES: readonly EmailIdentityDefinition[] = [
  { identityId: 'sales', displayName: 'AxorOS Sales', allowedAgents: ['sales_agent'], externalUse: true },
  { identityId: 'support', displayName: 'AxorOS Support', allowedAgents: ['support_agent'], externalUse: true },
  { identityId: 'finance', displayName: 'AxorOS Finance', allowedAgents: ['finance_agent'], externalUse: true },
  { identityId: 'marketing', displayName: 'AxorOS Marketing', allowedAgents: ['marketing_agent'], externalUse: true },
  { identityId: 'operations', displayName: 'AxorOS Operations', allowedAgents: ['operations_agent'], externalUse: true },
] as const;

export function getEmailIdentity(identityId: string): EmailIdentityDefinition | undefined {
  return EMAIL_IDENTITIES.find((identity) => identity.identityId === identityId);
}

export function assertAgentMayUseEmailIdentity(agentId: CoreAgentId, identityId: string): EmailIdentityDefinition {
  const identity = getEmailIdentity(identityId);
  if (!identity) throw new Error(`email identity is not registered: ${identityId}.`);
  if (!identity.allowedAgents.includes(agentId)) {
    throw new Error(`agent ${agentId} may not use email identity ${identityId}.`);
  }
  if (!identity.externalUse) throw new Error(`email identity ${identityId} is not approved for external use.`);
  return identity;
}
