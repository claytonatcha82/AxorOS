export const LEAD_AGENT_CHARTER = {
  id: 'lead_agent',
  role: 'Business Development Intelligence Agent',
  mission: 'Continuously discover, research, qualify and prioritise businesses most likely to benefit from agency services.',
  permissions: {
    atlasOs: 'read',
    crm: 'create_update_qualification_only',
    publicWeb: 'read',
    leadDatabase: 'read_write',
    knowledgeAgent: 'request_context',
  },
  prohibitions: [
    'send_email', 'send_proposal', 'create_invoice', 'sign_contract', 'make_client_promise',
    'change_crm_stage_beyond_qualification', 'invent_business_data', 'reject_lead_only_because_international',
  ] as const,
} as const;

export type LeadAgentProhibition = typeof LEAD_AGENT_CHARTER.prohibitions[number];

export function leadAgentMayPerform(action: string): boolean {
  return !LEAD_AGENT_CHARTER.prohibitions.includes(action as LeadAgentProhibition);
}

export const LEAD_MARKET_TIERS = {
  south_africa: 1,
  southern_africa: 2,
  rest_of_africa: 3,
  global: 4,
} as const;

export function marketTierIsServiceRestriction(): false {
  return false;
}
