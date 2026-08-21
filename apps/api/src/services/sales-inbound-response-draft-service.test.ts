import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesInboundResponseDraftService } from './sales-inbound-response-draft-service.js';
import type { SalesInboundNextActionResolution } from './sales-inbound-next-action-resolver.js';

function resolution(
  overrides: Partial<SalesInboundNextActionResolution> = {},
): SalesInboundNextActionResolution {
  return {
    inboundEvidenceId: 'evidence-1',
    providerMessageId: 'provider-1',
    primaryCategory: 'positive_interest',
    nextAction: 'prepare_sales_response',
    owner: 'sales_agent',
    humanReviewRequired: true,
    autonomousResponseAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    discountAuthorised: false,
    commercialCommitmentAuthorised: false,
    contractAuthorised: false,
    ...overrides,
  };
}

test('records an internal inbound response draft without granting authority', async () => {
  const events: Array<Record<string, unknown>> = [];
  const repository = {
    async createWorkflowEvent(event: Record<string, unknown>) {
      events.push(event);
      return { id: 'workflow-1', ...event };
    },
  };
  const service = createSalesInboundResponseDraftService(repository as never);

  const result = await service.create({
    resolution: resolution(),
    leadId: 'lead-1',
    recipientEmail: 'prospect@example.com',
    subject: 'Re: Website enquiry',
    body: 'Thank you for your reply. Here is the information for human review.',
  });

  assert.equal(result.draft.status, 'internal_review_required');
  assert.equal(result.draft.humanReviewRequired, true);
  assert.equal(result.draft.preparationOnly, true);
  assert.equal(result.draft.responseAuthorised, false);
  assert.equal(result.draft.sendAuthorised, false);
  assert.equal(result.draft.pricingAuthorised, false);
  assert.equal(result.draft.discountAuthorised, false);
  assert.equal(result.draft.commercialCommitmentAuthorised, false);
  assert.equal(result.draft.contractAuthorised, false);
  assert.equal(result.draft.nextAction, 'request_human_inbound_response_draft_review');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'sales_inbound_response_draft_recorded');
});

test('blocks categories that Atlas says must not progress to a Sales response draft', async () => {
  const repository = {
    async createWorkflowEvent() {
      throw new Error('must not persist');
    },
  };
  const service = createSalesInboundResponseDraftService(repository as never);

  for (const primaryCategory of ['opt_out', 'automated_response', 'delivery_failure', 'not_interested'] as const) {
    await assert.rejects(
      () => service.create({
        resolution: resolution({ primaryCategory }),
        leadId: 'lead-1',
        recipientEmail: 'prospect@example.com',
        subject: 'Re: Website enquiry',
        body: 'Draft',
      }),
      new RegExp(`Inbound category ${primaryCategory} is not eligible for response drafting`),
    );
  }
});

test('fails closed when human review is not required', async () => {
  const repository = {
    async createWorkflowEvent() {
      throw new Error('must not persist');
    },
  };
  const service = createSalesInboundResponseDraftService(repository as never);

  await assert.rejects(
    () => service.create({
      resolution: resolution({ humanReviewRequired: false }),
      leadId: 'lead-1',
      recipientEmail: 'prospect@example.com',
      subject: 'Re: Website enquiry',
      body: 'Draft',
    }),
    /Stage 1 inbound response drafting requires human review/,
  );
});
