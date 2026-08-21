import assert from 'node:assert/strict';

import { createSalesInboundReplyClassificationRecord } from '../apps/api/dist/services/sales-inbound-reply-classification-contract.js';
import { resolveSalesInboundNextAction } from '../apps/api/dist/services/sales-inbound-next-action-resolver.js';
import { createSalesInboundResponseDraftService } from '../apps/api/dist/services/sales-inbound-response-draft-service.js';
import { createSalesOutreachDraftReviewService } from '../apps/api/dist/services/sales-outreach-draft-review-service.js';
import { createSalesSupervisedSendGateService } from '../apps/api/dist/services/sales-supervised-send-gate-service.js';

const now = '2026-08-21T18:45:00.000Z';
const records = new Map();
let sequence = 0;

const repository = {
  async getWorkflowEventById(id) {
    return records.get(id) ?? null;
  },
  async createWorkflowEvent(input) {
    sequence += 1;
    const record = {
      id: `controlled-${sequence}`,
      clientId: null,
      projectId: null,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
      createdAt: now,
    };
    records.set(record.id, record);
    return record;
  },
};

console.log('\nAxorOS Sales Inbound — Controlled End-to-End Test');
console.log('================================================');
console.log('Synthetic scenario only. No Gmail/provider send will occur.\n');

const classification = createSalesInboundReplyClassificationRecord({
  inboundEvidenceId: 'synthetic-evidence-1',
  outboundRecordId: 'synthetic-outbound-1',
  leadId: 'synthetic-lead-1',
  providerMessageId: 'synthetic-provider-message-1',
  primaryCategory: 'positive_interest',
  evidenceReasons: [{ reason: 'Synthetic prospect expressed interest in discussing the service.' }],
  deterministicSignals: {
    optOutDetected: false,
    automatedResponseDetected: false,
    deliveryFailureDetected: false,
  },
  commercialTopicDetected: false,
  sensitiveTopicDetected: false,
  uncertaintyDetected: false,
  classificationSource: 'model_assisted',
  modelReference: 'controlled-test-model',
  nextAction: 'prepare_sales_response',
  humanReviewRequired: true,
  classifiedAt: now,
});

console.log(`[1] Classification: ${classification.primaryCategory}`);
assert.equal(classification.responseAuthorised, false);
assert.equal(classification.pricingAuthorised, false);
assert.equal(classification.commercialCommitmentAuthorised, false);

const resolution = resolveSalesInboundNextAction(classification);
console.log(`[2] Governed next action: ${resolution.nextAction}`);
console.log(`    Human review required: ${resolution.humanReviewRequired}`);
assert.equal(resolution.nextAction, 'prepare_sales_response');
assert.equal(resolution.sendAuthorised, false);

const draftService = createSalesInboundResponseDraftService(repository);
const draftOutcome = await draftService.create({
  resolution,
  leadId: classification.leadId,
  recipientEmail: 'synthetic-prospect@example.invalid',
  subject: 'Re: Website enquiry',
  body: 'Thank you for your reply. We would be happy to continue the conversation about your website requirements.',
});
console.log(`[3] Internal response draft: ${draftOutcome.record.id}`);
console.log(`    Status: ${draftOutcome.draft.status}`);
console.log(`    Send authorised: ${draftOutcome.draft.sendAuthorised}`);
assert.equal(draftOutcome.draft.humanReviewRequired, true);
assert.equal(draftOutcome.draft.sendAuthorised, false);

const reviewService = createSalesOutreachDraftReviewService(repository);
const reviewOutcome = await reviewService.review(draftOutcome.record.id, 'approved');
console.log(`[4] Human Executive draft review: ${reviewOutcome.review.decision}`);
console.log(`    Send authorised after draft review: ${reviewOutcome.review.sendAuthorised}`);
assert.equal(reviewOutcome.review.draftKind, 'inbound_response');
assert.equal(reviewOutcome.review.sendAuthorised, false);
assert.equal(reviewOutcome.review.nextAction, 'prepare_supervised_send_gate');

const sendGateService = createSalesSupervisedSendGateService(repository);
const gateOutcome = await sendGateService.decide(reviewOutcome.record.id, 'approved');
console.log(`[5] Existing supervised send gate: ${gateOutcome.gate.decision}`);
console.log(`    Human send authority granted: ${gateOutcome.gate.sendAuthorised}`);
console.log(`    Next action: ${gateOutcome.gate.nextAction}`);
assert.equal(gateOutcome.gate.draftKind, 'inbound_response');
assert.equal(gateOutcome.gate.supervised, true);
assert.equal(gateOutcome.gate.sendAuthorised, true);
assert.equal(gateOutcome.gate.pricingAuthorised, false);
assert.equal(gateOutcome.gate.discountAuthorised, false);
assert.equal(gateOutcome.gate.contractAuthorised, false);
assert.equal(gateOutcome.gate.commercialCommitmentAuthorised, false);

console.log('\nSTOP: provider execution intentionally not invoked.');
console.log('PASS Controlled Sales inbound flow reached the existing supervised send boundary without autonomous sending.\n');
