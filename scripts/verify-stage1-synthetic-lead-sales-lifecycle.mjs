import assert from 'node:assert/strict';

import {
  validateQualifiedLeadSalesHandoff,
} from '../apps/api/dist/agents/lead-sales-handoff.js';

import {
  salesInternalIntakeHandler,
} from '../apps/api/dist/agents/sales-internal-intake-handler.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const leadId = `lead:stage1:synthetic:${suffix}`;
const eligibilityRecordId = `lead-eligibility:stage1:synthetic:${suffix}`;
const commercialRecordReference = `commercial:stage1:synthetic:${suffix}`;
const correlationId = `corr:stage1:synthetic:${suffix}`;
const executionId = `exec:stage1:synthetic:sales-intake:${suffix}`;

console.log('\nAxorOS Stage 1 — Synthetic Lead → Sales Lifecycle');
console.log('=================================================');
console.log('Synthetic scenario only. No external provider execution will occur.\n');

const handoff = {
  leadId,
  company: 'Stage 1 Synthetic Property Agency',
  industry: 'Property',
  location: 'KwaZulu-Natal, South Africa',
  website: 'https://synthetic.invalid',
  auditSummary:
    'Synthetic evidence indicates the business requires a governed website delivery workflow.',
  businessSummary:
    'Synthetic property agency used exclusively for AxorOS Stage 1 lifecycle verification.',
  recommendedServices: [
    'Website design and development',
  ],
  painPoints: [
    'Existing digital presence does not adequately support property enquiries.',
  ],

  // Legacy contract field retained only because the current handoff
  // interface still requires it. It is not used as autonomous authority.
  leadScore: 80,

  confidence: 0.95,
  knowledgeReferences: [
    'atlas://stage1/synthetic-lead-sales',
  ],
  recommendedSalesStrategy:
    'Proceed only into governed internal Sales intake. No outreach is authorised.',
};

const handoffErrors = validateQualifiedLeadSalesHandoff(handoff);

assert.deepEqual(
  handoffErrors,
  [],
  `Synthetic Lead → Sales handoff failed validation: ${handoffErrors.join(' ')}`,
);

console.log('[1] Lead → Sales opportunity package validated.');
console.log(`    leadId: ${leadId}`);

const task = {
  taskId: `task:${executionId}`,
  executionId,
  originAgent: 'lead_agent',
  destinationAgent: 'sales_agent',
  objective:
    'Perform governed internal Sales intake for the Stage 1 synthetic opportunity.',
  priority: 'normal',

  context: {
    leadId,
    eligibilityRecordId,
    commercialRecordReference,
  },

  knowledgeReferences: [
    'atlas://stage1/synthetic-lead-sales',
  ],

  inputs: {
    salesIntakeOnly: true,
    salesDispatchAuthorised: false,
    outreachAuthorised: false,
    qualifiedLeadHandoff: handoff,
  },

  expectedOutput:
    'Accepted internal Sales intake without external communication authority.',

  dependencies: [],
  risks: [],
  confidence: 1,
  approvalRequired: false,
  status: 'ready',
  nextAction: 'execute_destination_capability',
  attempt: 1,
  maxAttempts: 1,
  correlationId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const salesOutcome = await salesInternalIntakeHandler.execute(task);

assert.equal(salesOutcome.status, 'completed');
assert.equal(salesOutcome.agentId, 'sales_agent');
assert.equal(salesOutcome.output.intakeAccepted, true);
assert.equal(salesOutcome.output.leadId, leadId);
assert.equal(
  salesOutcome.output.eligibilityRecordId,
  eligibilityRecordId,
);

assert.equal(
  salesOutcome.output.salesDispatchAuthorised,
  false,
  'Synthetic intake unexpectedly authorised Sales dispatch.',
);

assert.equal(
  salesOutcome.output.outreachAuthorised,
  false,
  'Synthetic intake unexpectedly authorised outreach.',
);

assert.equal(
  salesOutcome.output.nextAction,
  'define_governed_sales_opportunity_assessment',
);

console.log('[2] Governed Sales internal intake accepted.');
console.log('    Sales dispatch authorised: false');
console.log('    Outreach authorised: false');

console.log('[3] Stage 1 lifecycle identity established.');
console.log(`    commercialRecordReference: ${commercialRecordReference}`);
console.log(`    correlationId: ${correlationId}`);

console.log('\nSTOP: no Gmail, payment, deployment, or other external integration invoked.');

console.log(
  'PASS  Synthetic Lead → Sales lifecycle reached governed internal Sales intake without granting outreach or commercial execution authority.\n',
);
