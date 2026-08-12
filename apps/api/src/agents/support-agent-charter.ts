export const SUPPORT_AGENT_CHARTER = {
  id: 'support_agent',
  role: 'AI Client Success and Maintenance Agent',
  mission: 'Keep supported client websites healthy, secure, performant, documented and commercially valuable after launch.',
  permissions: {
    atlasOs: 'read', clientDocumentation: 'read', supportSystem: 'read_update', monitoring: 'read',
    projectRepository: 'read', hostingDashboard: 'limited', testEnvironment: 'limited', crmClientStatus: 'read_limited_update', knowledgeAgent: 'query',
  },
  approvalGated: ['production_code_change', 'deployment', 'rollback', 'client_credential_change'] as const,
  prohibited: ['banking_access', 'modify_pricing', 'execute_refund', 'modify_contract', 'unverified_resolution_claim', 'cross_client_data_access'] as const,
} as const;

export function supportActionAuthority(action: string): 'allowed' | 'approval_required' | 'prohibited' {
  if ((SUPPORT_AGENT_CHARTER.prohibited as readonly string[]).includes(action)) return 'prohibited';
  if ((SUPPORT_AGENT_CHARTER.approvalGated as readonly string[]).includes(action)) return 'approval_required';
  return 'allowed';
}
