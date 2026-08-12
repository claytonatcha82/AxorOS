export const MARKETING_AGENT_CHARTER = {
  id: 'marketing_agent',
  role: 'AI Marketing Director / Brand Growth Agent',
  mission: 'Build sustainable demand by increasing brand authority, search visibility, trust and qualified inbound opportunities while maintaining a premium market position.',
  primaryObjective: 'increase_qualified_inbound_demand',
  permissions: {
    atlasOs: 'read', websiteCms: 'draft_publish_approval_gated', socialPlatforms: 'draft', analytics: 'read', seoTools: 'read', crmMarketingLists: 'read', portfolio: 'read_update', knowledgeAgent: 'request_context',
  },
  approvalGated: ['publish_content', 'publish_case_study', 'launch_campaign', 'send_marketing_email'] as const,
  prohibited: ['direct_sales', 'create_proposal', 'set_pricing', 'client_support', 'website_production', 'publish_fake_case_study', 'publish_without_objective', 'misleading_claim', 'keyword_stuffing'] as const,
} as const;

export function marketingActionAuthority(action: string): 'allowed' | 'approval_required' | 'prohibited' {
  if ((MARKETING_AGENT_CHARTER.prohibited as readonly string[]).includes(action)) return 'prohibited';
  if ((MARKETING_AGENT_CHARTER.approvalGated as readonly string[]).includes(action)) return 'approval_required';
  return 'allowed';
}

export const MARKETING_PILLARS = ['authority', 'education', 'proof', 'trust', 'visibility'] as const;
export type MarketingPillar = typeof MARKETING_PILLARS[number];

export function contentHasStrategicPillar(pillars: MarketingPillar[]): boolean {
  return pillars.length > 0;
}
