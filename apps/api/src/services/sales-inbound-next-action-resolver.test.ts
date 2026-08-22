import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSalesInboundReplyClassificationRecord,
  type SalesInboundReplyCategory,
  type SalesInboundReplyNextAction,
} from './sales-inbound-reply-classification-contract.js';
import { resolveSalesInboundNextAction } from './sales-inbound-next-action-resolver.js';

function classification(
  primaryCategory: SalesInboundReplyCategory,
  nextAction: SalesInboundReplyNextAction,
  options: { commercialTopicDetected?: boolean; humanReviewRequired?: boolean } = {},
) {
  return createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: `evidence:${primaryCategory}`,
    outboundRecordId: 'outbound:1',
    leadId: 'lead:1',
    providerMessageId: `provider:${primaryCategory}`,
    primaryCategory,
    evidenceReasons: [{ reason: 'Controlled test evidence.' }],
    deterministicSignals: {
      optOutDetected: primaryCategory === 'opt_out',
      automatedResponseDetected: primaryCategory === 'automated_response',
      deliveryFailureDetected: primaryCategory === 'delivery_failure',
    },
    commercialTopicDetected: options.commercialTopicDetected ?? false,
    sensitiveTopicDetected: primaryCategory === 'sensitive_or_high_risk',
    uncertaintyDetected: primaryCategory === 'ambiguous',
    classificationSource: 'deterministic',
    nextAction,
    humanReviewRequired: options.humanReviewRequired ?? false,
    classifiedAt: '2026-08-21T00:00:00.000Z',
  });
}

test('preserves the governed next action without creating send or commercial authority', () => {
  const result = resolveSalesInboundNextAction(
    classification('positive_interest', 'prepare_sales_response', {
      humanReviewRequired: true,
    }),
  );

  assert.equal(result.nextAction, 'prepare_sales_response');
  assert.equal(result.owner, 'sales_agent');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.autonomousResponseAuthorised, false);
  assert.equal(result.sendAuthorised, false);
  assert.equal(result.pricingAuthorised, false);
  assert.equal(result.discountAuthorised, false);
  assert.equal(result.commercialCommitmentAuthorised, false);
  assert.equal(result.contractAuthorised, false);
});

test('keeps explicit opt-out on the suppression path with no response authority', () => {
  const result = resolveSalesInboundNextAction(
    classification('opt_out', 'record_suppression'),
  );

  assert.equal(result.nextAction, 'record_suppression');
  assert.equal(result.owner, 'sales_agent');
  assert.equal(result.autonomousResponseAuthorised, false);
  assert.equal(result.sendAuthorised, false);
});

test('forces ambiguous classifications into human review', () => {
  const result = resolveSalesInboundNextAction(
    classification('ambiguous', 'human_review_required'),
  );

  assert.equal(result.owner, 'sales_agent');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.sendAuthorised, false);
});

test('routes non-commercial high-risk matters to the Human Executive', () => {
  const result = resolveSalesInboundNextAction(
    classification(
      'sensitive_or_high_risk',
      'route_to_human_executive_or_appropriate_owner',
      { humanReviewRequired: true },
    ),
  );

  assert.equal(result.owner, 'human_executive');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.autonomousResponseAuthorised, false);
});

test('routes commercially flagged high-risk matters to Finance without granting payment authority', () => {
  const result = resolveSalesInboundNextAction(
    classification(
      'sensitive_or_high_risk',
      'route_to_human_executive_or_appropriate_owner',
      { commercialTopicDetected: true, humanReviewRequired: true },
    ),
  );

  assert.equal(result.owner, 'finance_agent');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.sendAuthorised, false);
  assert.equal(result.commercialCommitmentAuthorised, false);
});
