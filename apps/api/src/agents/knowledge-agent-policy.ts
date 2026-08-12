export const KNOWLEDGE_AGENT_ID = 'knowledge_agent' as const;
export const KNOWLEDGE_AGENT_ROLE = 'Knowledge and Retrieval Intelligence' as const;

export const KNOWLEDGE_AGENT_PERMISSIONS = {
  atlasOs: 'read',
  atlasMetadata: 'read',
  searchIndex: 'read',
  vectorIndex: 'read_if_configured',
  clientProjectKnowledge: 'controlled_read',
  crm: 'none',
  email: 'none',
  payments: 'none',
  banking: 'none',
  github: 'none_initially',
} as const;

export const KNOWLEDGE_AGENT_PROHIBITIONS = [
  'change_business_policy',
  'rewrite_atlas_automatically',
  'send_email',
  'communicate_with_clients',
  'create_invoices',
  'make_payments',
  'approve_contracts',
  'deploy_websites',
  'alter_pricing',
  'make_executive_decisions',
  'expose_restricted_secret_values',
] as const;

export type KnowledgeClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export function knowledgeAgentMayAccess(classification: KnowledgeClassification): boolean {
  return classification !== 'restricted';
}

export function knowledgeAgentIsProhibited(action: string): boolean {
  return (KNOWLEDGE_AGENT_PROHIBITIONS as readonly string[]).includes(action);
}
