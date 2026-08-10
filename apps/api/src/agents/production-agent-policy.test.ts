import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_AGENT_AUTONOMY,
  PRODUCTION_AGENT_PERMISSIONS,
  evaluateProductionStartGate,
  productionAgentIsProhibited,
} from './production-agent-policy.js';

test('production remains blocked until every mandatory commercial and planning gate passes', () => {
  const result = evaluateProductionStartGate({
    proposalAccepted: true,
    contractSigned: true,
    requiredPaymentConfirmed: false,
    onboardingComplete: true,
    requiredAssetsAvailable: false,
    projectPlanningComplete: true,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.productionUnlocked, false);
  assert.deepEqual(result.missingRequirements, ['requiredPaymentConfirmed', 'requiredAssetsAvailable']);
});

test('production unlocks only when every mandatory start gate passes', () => {
  const result = evaluateProductionStartGate({
    proposalAccepted: true,
    contractSigned: true,
    requiredPaymentConfirmed: true,
    onboardingComplete: true,
    requiredAssetsAvailable: true,
    projectPlanningComplete: true,
  });

  assert.equal(result.status, 'unlocked');
  assert.equal(result.productionUnlocked, true);
  assert.deepEqual(result.missingRequirements, []);
});

test('production agent starts in copilot autonomy with approval-gated production deployment', () => {
  assert.equal(PRODUCTION_AGENT_AUTONOMY, 'copilot');
  assert.equal(PRODUCTION_AGENT_PERMISSIONS.atlasOs, 'read');
  assert.equal(PRODUCTION_AGENT_PERMISSIONS.gitRepository, 'read_write');
  assert.equal(PRODUCTION_AGENT_PERMISSIONS.testEnvironment, 'deploy');
  assert.equal(PRODUCTION_AGENT_PERMISSIONS.productionEnvironment, 'approval_gated');
});

test('production agent explicitly prohibits high-risk and cross-functional actions', () => {
  assert.equal(productionAgentIsProhibited('banking_controls'), true);
  assert.equal(productionAgentIsProhibited('legal_agreement_modification'), true);
  assert.equal(productionAgentIsProhibited('arbitrary_price_changes'), true);
  assert.equal(productionAgentIsProhibited('unapproved_production_deployment'), true);
  assert.equal(productionAgentIsProhibited('storing_secrets_in_source_code'), true);
  assert.equal(productionAgentIsProhibited('prepare_review_build'), false);
});
