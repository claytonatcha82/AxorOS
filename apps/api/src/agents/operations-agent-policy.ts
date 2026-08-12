export const OPERATIONS_AGENT_ID = 'operations_agent' as const;
export const OPERATIONS_AGENT_ROLE = 'Operational Orchestrator / Digital COO' as const;

export const OPERATIONS_AGENT_PERMISSIONS = {
  atlasOs: 'read',
  taskSystem: 'read_create_update',
  crmWorkflowStatus: 'read_update',
  projectManagement: 'read_update',
  agentStatus: 'read',
  kpiDashboards: 'read_update',
  calendarCoordination: 'limited_write',
  workflowLogs: 'read_write',
} as const;

export const OPERATIONS_AGENT_PROHIBITIONS = [
  'payment_execution',
  'contract_signing',
  'pricing_authority',
  'unrestricted_secret_access',
  'default_production_deployment',
  'legal_approval',
  'specialist_role_replacement',
] as const;

export function operationsAgentIsProhibited(action: string): boolean {
  return (OPERATIONS_AGENT_PROHIBITIONS as readonly string[]).includes(action);
}
