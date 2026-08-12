import type { MarketingPillar } from './marketing-agent-charter.js';

export type MarketingContentCategory = 'educational' | 'case_study' | 'industry_insight' | 'behind_the_scenes' | 'technical_guide' | 'business_growth' | 'ai_automation' | 'client_success_story';

export interface MarketingContentPlan {
  contentId: string;
  businessGoal: string;
  targetAudience: string;
  category: MarketingContentCategory;
  topic: string;
  pillars: MarketingPillar[];
  knowledgeReferences: string[];
  channel: 'website' | 'seo' | 'linkedin' | 'google_business_profile' | 'newsletter';
  successMetric: string;
}

export function validateMarketingContentPlan(plan: MarketingContentPlan): string[] {
  const errors: string[] = [];
  if (!plan.contentId.trim()) errors.push('contentId is required.');
  if (!plan.businessGoal.trim()) errors.push('businessGoal is required.');
  if (!plan.targetAudience.trim()) errors.push('targetAudience is required.');
  if (!plan.topic.trim()) errors.push('topic is required.');
  if (plan.pillars.length === 0) errors.push('at least one marketing pillar is required.');
  if (plan.knowledgeReferences.length === 0) errors.push('knowledgeReferences are required.');
  if (!plan.successMetric.trim()) errors.push('successMetric is required.');
  return errors;
}

export const BRAND_VOICE = {
  required: ['professional', 'helpful', 'confident', 'honest', 'educational', 'premium', 'human'],
  prohibited: ['arrogant', 'sensational', 'spammy', 'misleading'],
} as const;

export interface MarketingClaim {
  statement: string;
  evidenceReferences: string[];
  isResultClaim: boolean;
}

export function marketingClaimMayPublish(claim: MarketingClaim): boolean {
  if (!claim.statement.trim()) return false;
  if (claim.isResultClaim && claim.evidenceReferences.length === 0) return false;
  return true;
}
