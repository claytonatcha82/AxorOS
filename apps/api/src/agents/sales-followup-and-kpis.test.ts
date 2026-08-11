import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSalesKpis, evaluateSalesFollowUp, salesEscalationTarget } from './sales-followup-and-kpis.js';

test('sales follow-up cadence allows only approved timing windows', () => {
  assert.equal(evaluateSalesFollowUp({ step: 'follow_up_1', daysSinceInitialContact: 3, optedOut: false, doNotContact: false, duplicateDetected: false, activeConversation: false }).allowed, true);
  assert.equal(evaluateSalesFollowUp({ step: 'follow_up_2', daysSinceInitialContact: 6, optedOut: false, doNotContact: false, duplicateDetected: false, activeConversation: false }).allowed, false);
});

test('follow-up is blocked for opt-outs duplicates and active conversations', () => {
  const result = evaluateSalesFollowUp({ step: 'final_follow_up', daysSinceInitialContact: 14, optedOut: true, doNotContact: false, duplicateDetected: true, activeConversation: true });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('do-not-contact')));
  assert.ok(result.reasons.some((reason) => reason.includes('duplicate')));
  assert.ok(result.reasons.some((reason) => reason.includes('active conversation')));
});

test('sales escalation routes commercial legal and technical exceptions appropriately', () => {
  assert.equal(salesEscalationTarget('discount_requested'), 'operations');
  assert.equal(salesEscalationTarget('contract_deviation'), 'human_executive');
  assert.equal(salesEscalationTarget('technical_feasibility_concern'), 'production');
});

test('sales KPIs prioritise qualified lead conversion and economics', () => {
  const kpis = calculateSalesKpis({ qualifiedLeads: 20, positiveReplies: 8, discoveriesBooked: 5, proposalsSent: 4, wonDeals: 2, revenue: 40000, salesAgentCost: 2000 });
  assert.equal(kpis.qualifiedLeadToPayingClientConversion, 0.1);
  assert.equal(kpis.positiveReplyRate, 0.4);
  assert.equal(kpis.discoveryBookingRate, 0.25);
  assert.equal(kpis.proposalToWinRate, 0.5);
  assert.equal(kpis.grossRevenuePerSalesAgentCost, 20);
});
