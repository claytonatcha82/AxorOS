import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductionAgentHandoverReady,
  validateProductionAgentHandover,
  type ProductionAgentHandover,
} from './production-agent-handover.js';

function validHandover(): ProductionAgentHandover {
  return {
    projectId: 'project-1',
    clientId: 'client-1',
    business: 'Example Business',
    primaryContact: 'Primary Contact',
    projectObjective: 'Build a five-page business website',
    approvedScope: ['Five-page website'],
    deliverables: ['Production-ready website'],
    excludedScope: ['Booking system'],
    timeline: '4 weeks',
    milestones: ['Planning', 'Review build', 'Launch'],
    approvedProposal: 'proposal-1',
    contractStatus: 'signed',
    paymentStatus: 'required_payment_confirmed',
    brandAssets: ['logo.svg'],
    contentAssets: ['company-profile.pdf'],
    technicalRequirements: ['React', 'Vite'],
    requiredIntegrations: [],
    seoRequirements: ['Metadata', 'Sitemap'],
    accessibilityRequirements: ['Keyboard navigation'],
    supportRequirements: ['Support handover'],
    clientExpectations: ['Professional responsive design'],
    risks: [],
    openItems: [],
    startGate: {
      proposalAccepted: true,
      contractSigned: true,
      requiredPaymentConfirmed: true,
      onboardingComplete: true,
      requiredAssetsAvailable: true,
      projectPlanningComplete: true,
    },
  };
}

test('valid structured handover unlocks production when every start gate passes', () => {
  const result = validateProductionAgentHandover(validHandover());
  assert.equal(result.valid, true);
  assert.equal(result.productionReady, true);
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.startGate.status, 'unlocked');
});

test('incomplete structured handover is rejected even when commercial gates pass', () => {
  const handover = validHandover();
  handover.projectObjective = '   ';
  handover.deliverables = [];

  const result = validateProductionAgentHandover(handover);
  assert.equal(result.valid, false);
  assert.equal(result.productionReady, false);
  assert.deepEqual(result.missingFields, ['projectObjective', 'deliverables']);
  assert.throws(() => assertProductionAgentHandoverReady(handover), /Production handover is incomplete/);
});

test('complete handover remains blocked when a mandatory production gate fails', () => {
  const handover = validHandover();
  handover.startGate.requiredPaymentConfirmed = false;

  const result = validateProductionAgentHandover(handover);
  assert.equal(result.valid, true);
  assert.equal(result.productionReady, false);
  assert.deepEqual(result.startGate.missingRequirements, ['requiredPaymentConfirmed']);
  assert.throws(() => assertProductionAgentHandoverReady(handover), /Production is blocked: requiredPaymentConfirmed/);
});
