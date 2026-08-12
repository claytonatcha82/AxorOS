import assert from 'node:assert/strict';
import test from 'node:test';
import { marketingPublishAction, validateMarketingCampaign } from './marketing-campaign.js';

test('campaigns require objective audience channel metrics and review date', () => {
  assert.deepEqual(validateMarketingCampaign({ campaignId: 'c1', objective: 'increase qualified engineering inbound leads', targetAudience: 'engineering firms', message: 'Build credibility with a stronger digital presence', offer: 'website strategy consultation', channels: ['website', 'linkedin'], duration: '30 days', successMetrics: ['qualified inbound leads', 'conversion rate'], budget: 0, owner: 'marketing_agent', reviewDate: '2026-09-12', strategic: false }), []);
});

test('stage one always remains draft-only', () => {
  assert.equal(marketingPublishAction(1, { routineEducational: true, scheduledCampaign: false, strategic: false }), 'draft_only');
});

test('routine content autonomy expands gradually while strategic campaigns stay controlled', () => {
  assert.equal(marketingPublishAction(2, { routineEducational: true, scheduledCampaign: false, strategic: false }), 'routine_auto_publish');
  assert.equal(marketingPublishAction(3, { routineEducational: false, scheduledCampaign: true, strategic: false }), 'scheduled_campaign_auto_publish');
  assert.equal(marketingPublishAction(4, { routineEducational: false, scheduledCampaign: true, strategic: true }), 'strategic_approval_required');
});
