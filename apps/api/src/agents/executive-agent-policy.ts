export const EXECUTIVE_AGENT_ID = 'executive_agent' as const;
export const EXECUTIVE_AGENT_ROLE = 'Digital Chief of Staff / Strategic Orchestrator' as const;

export const EXECUTIVE_AGENT_PERMISSIONS = {
  atlasOs: 'read',
  executiveDashboard: 'read',
  crmSummaries: 'read',
  financialSummaries: 'read',
  projectSummaries: 'read',
  marketingSummaries: 'read',
  supportSummaries: 'read',
  agentHealthReports: 'read',
  operationsInstructions: 'create',
} as const;

export const EXECUTIVE_AGENT_PROHIBITIONS = [
  'bank_account_controls',
  'raw_password_access',
  'payment_execution',
  'production_deployment',
  'contract_execution',
  'lead_sourcing',
  'sales_email_sending',
  'website_building',
  'support_ticket_execution',
  'marketing_content_posting',
  'direct_specialist_override_without_justification',
  'inventing_unapproved_business_objectives',
] as const;

export type ExecutiveDecisionLevel = 1 | 2 | 3 | 4;

export interface ExecutiveDecisionClassification {
  level: ExecutiveDecisionLevel;
  authority: 'autonomous' | 'supervised' | 'approval_required' | 'human_only';
  mayExecute: boolean;
  humanApprovalRequired: boolean;
}

export function classifyExecutiveDecision(level: ExecutiveDecisionLevel): ExecutiveDecisionClassification {
  switch (level) {
    case 1:
      return { level, authority: 'autonomous', mayExecute: true, humanApprovalRequired: false };
    case 2:
      return { level, authority: 'supervised', mayExecute: true, humanApprovalRequired: false };
    case 3:
      return { level, authority: 'approval_required', mayExecute: false, humanApprovalRequired: true };
    case 4:
      return { level, authority: 'human_only', mayExecute: false, humanApprovalRequired: true };
  }
}

export function executiveAgentIsProhibited(action: string): boolean {
  return (EXECUTIVE_AGENT_PROHIBITIONS as readonly string[]).includes(action);
}
