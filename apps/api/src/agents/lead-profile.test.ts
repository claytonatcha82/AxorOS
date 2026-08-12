import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionLeadStatus, leadPriorityForScore, validateLeadCompanyProfile } from './lead-profile.js';

test('lead lifecycle follows discovery research qualification prioritisation assignment and sales', () => {
  assert.equal(canTransitionLeadStatus('discovered', 'researching'), true);
  assert.equal(canTransitionLeadStatus('researching', 'qualified'), true);
  assert.equal(canTransitionLeadStatus('qualified', 'prioritised'), true);
  assert.equal(canTransitionLeadStatus('prioritised', 'assigned'), true);
  assert.equal(canTransitionLeadStatus('assigned', 'sales'), true);
  assert.equal(canTransitionLeadStatus('discovered', 'sales'), false);
});

test('lead priority follows approved score bands', () => {
  assert.equal(leadPriorityForScore(97), 'immediate');
  assert.equal(leadPriorityForScore(92), 'very_high');
  assert.equal(leadPriorityForScore(85), 'high');
  assert.equal(leadPriorityForScore(75), 'medium');
  assert.equal(leadPriorityForScore(60), 'low');
});

test('lead profile requires traceable public evidence and bounded confidence', () => {
  const errors = validateLeadCompanyProfile({
    leadId: 'lead-1', companyName: 'Example Engineering', industry: 'Engineering', country: 'South Africa', socials: [],
    currentWebsiteStatus: 'poor', technology: [], estimatedOpportunity: 'Website modernisation', painPoints: ['Poor mobile experience'],
    recommendedServices: ['Website redesign'], leadScore: 88, priority: 'high', confidence: 0.9, sourceUrls: [],
  });
  assert.ok(errors.includes('at least one public source URL is required for traceability.'));
});
