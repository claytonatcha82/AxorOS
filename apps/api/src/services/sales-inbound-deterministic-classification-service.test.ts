import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySalesInboundDeterministically } from './sales-inbound-deterministic-classification-service.js';

const baseInput = {
  inboundEvidenceId: 'evidence-1',
  outboundRecordId: 'outbound-1',
  leadId: 'lead-1',
  providerMessageId: 'gmail-message-1',
  classifiedAt: '2026-08-21T12:00:00.000Z',
};

test('applies deterministic opt-out classification before any model classification', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Please remove me from your mailing list and do not contact me again.',
  });

  assert.equal(result.classificationApplied, true);
  if (!result.classificationApplied) assert.fail('Expected deterministic classification.');

  assert.equal(result.classification.primaryCategory, 'opt_out');
  assert.equal(result.classification.classificationSource, 'deterministic');
  assert.equal(result.classification.deterministicSignals.optOutDetected, true);
  assert.equal(result.classification.nextAction, 'record_suppression');
  assert.equal(result.classification.responseAuthorised, false);
  assert.equal(result.classification.pricingAuthorised, false);
  assert.equal(result.classification.discountAuthorised, false);
  assert.equal(result.classification.commercialCommitmentAuthorised, false);
  assert.equal(result.classification.contractAuthorised, false);
});

test('uses snippet evidence when text body is unavailable', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    snippet: 'Unsubscribe please.',
  });

  assert.equal(result.classificationApplied, true);
  if (!result.classificationApplied) assert.fail('Expected deterministic classification.');
  assert.equal(result.classification.primaryCategory, 'opt_out');
});

test('gives explicit opt-out precedence over automated-response signals', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Automatic reply: I am out of office. Please unsubscribe me.',
  });

  assert.equal(result.classificationApplied, true);
  if (!result.classificationApplied) assert.fail('Expected deterministic classification.');
  assert.equal(result.classification.primaryCategory, 'opt_out');
  assert.equal(result.classification.deterministicSignals.optOutDetected, true);
  assert.equal(result.classification.deterministicSignals.automatedResponseDetected, false);
});

test('classifies known automated responses deterministically before model classification', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Automatic reply: I am currently out of the office and will return next week.',
  });

  assert.equal(result.classificationApplied, true);
  if (!result.classificationApplied) assert.fail('Expected deterministic classification.');
  assert.equal(result.classification.primaryCategory, 'automated_response');
  assert.equal(result.classification.classificationSource, 'deterministic');
  assert.equal(result.classification.deterministicSignals.automatedResponseDetected, true);
  assert.equal(result.classification.nextAction, 'await_or_schedule_governed_evaluation');
  assert.equal(result.classification.responseAuthorised, false);
});

test('classifies delivery failure only when provider or system provenance is explicit', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Delivery has failed because the address was not found.',
    deliveryFailureProvenance: 'provider_or_system',
  });

  assert.equal(result.classificationApplied, true);
  if (!result.classificationApplied) assert.fail('Expected deterministic classification.');
  assert.equal(result.classification.primaryCategory, 'delivery_failure');
  assert.equal(result.classification.classificationSource, 'deterministic');
  assert.equal(result.classification.deterministicSignals.deliveryFailureDetected, true);
  assert.equal(result.classification.nextAction, 'verify_contact_data_or_escalate');
  assert.equal(result.classification.responseAuthorised, false);
});

test('does not treat bounce-like ordinary message content as authoritative delivery failure evidence', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Our customer said their delivery has failed before, can you help?',
  });

  assert.deepEqual(result, { classificationApplied: false });
});

test('does not deterministically classify ordinary rejection as opt-out', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Thanks, but we are not interested.',
  });

  assert.deepEqual(result, { classificationApplied: false });
});

test('does not deterministically classify positive interest', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Yes, please tell me more about your website service.',
  });

  assert.deepEqual(result, { classificationApplied: false });
});

test('opt-out classification never authorises an external response', () => {
  const result = classifySalesInboundDeterministically({
    ...baseInput,
    textBody: 'Stop emailing me.',
  });

  assert.equal(result.classificationApplied, true);
  if (!result.classificationApplied) assert.fail('Expected deterministic classification.');
  assert.equal(result.classification.responseAuthorised, false);
  assert.equal(result.classification.nextAction, 'record_suppression');
});
