export const SALES_AGENT_ID = 'sales_agent' as const;
export const SALES_AGENT_ROLE = 'AI Sales Executive / Client Conversion Agent' as const;
export const SALES_AGENT_AUTONOMY = 'draft_mode' as const;

export const SALES_AGENT_PERMISSIONS = {
  atlasOs: 'read',
  crm: 'read_update',
  qualifiedLeads: 'read',
  email: 'draft',
  calendar: 'read_schedule',
  proposalSystem: 'create_draft',
  approvedPricing: 'read',
  salesTemplates: 'read',
} as const;

export const SALES_AGENT_PROHIBITIONS = [
  'banking_access',
  'payment_credentials_access',
  'contract_signing',
  'refund_execution',
  'unrestricted_discounts',
  'production_deployment',
  'permanent_pricing_changes',
  'major_contract_deviations',
  'fabricated_personalisation',
  'fabricated_urgency',
  'continuing_after_opt_out',
  'promising_unverified_results',
  'sending_without_required_approval',
] as const;

export function salesAgentIsProhibited(action: string): boolean {
  return (SALES_AGENT_PROHIBITIONS as readonly string[]).includes(action);
}
