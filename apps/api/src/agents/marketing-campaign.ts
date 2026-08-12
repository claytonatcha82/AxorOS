export type MarketingApprovalStage = 1 | 2 | 3 | 4;

export interface MarketingCampaign {
  campaignId: string;
  objective: string;
  targetAudience: string;
  message: string;
  offer: string;
  channels: Array<'website' | 'seo' | 'linkedin' | 'google_business_profile' | 'newsletter'>;
  duration: string;
  successMetrics: string[];
  budget: number;
  owner: string;
  reviewDate: string;
  strategic: boolean;
}

export function validateMarketingCampaign(campaign: MarketingCampaign): string[] {
  const errors: string[] = [];
  if (!campaign.campaignId.trim()) errors.push('campaignId is required.');
  if (!campaign.objective.trim()) errors.push('objective is required.');
  if (!campaign.targetAudience.trim()) errors.push('targetAudience is required.');
  if (!campaign.message.trim()) errors.push('message is required.');
  if (campaign.channels.length === 0) errors.push('at least one channel is required.');
  if (campaign.successMetrics.length === 0) errors.push('successMetrics are required.');
  if (campaign.budget < 0) errors.push('budget cannot be negative.');
  if (!campaign.reviewDate.trim()) errors.push('reviewDate is required.');
  return errors;
}

export type MarketingPublishAction = 'draft_only' | 'routine_auto_publish' | 'scheduled_campaign_auto_publish' | 'strategic_approval_required';

export function marketingPublishAction(stage: MarketingApprovalStage, input: { routineEducational: boolean; scheduledCampaign: boolean; strategic: boolean }): MarketingPublishAction {
  if (stage === 1) return 'draft_only';
  if (stage === 2) return input.routineEducational && !input.strategic ? 'routine_auto_publish' : 'draft_only';
  if (stage === 3) {
    if (input.strategic) return 'strategic_approval_required';
    if (input.scheduledCampaign) return 'scheduled_campaign_auto_publish';
    if (input.routineEducational) return 'routine_auto_publish';
    return 'draft_only';
  }
  return input.strategic ? 'strategic_approval_required' : (input.scheduledCampaign ? 'scheduled_campaign_auto_publish' : 'routine_auto_publish');
}
