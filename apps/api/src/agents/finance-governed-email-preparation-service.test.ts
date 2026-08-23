import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceGovernedEmailPreparationService } from './finance-governed-email-preparation-service.js';

function decision() {
  return {
    commercialRecordReference: 'commercial:finance-email:1',
    gate: 'PRODUCTION_START' as const,
    state: 'AWAITING_VERIFIED_PAYMENT' as const,
    reason: 'No authoritative provider payment state has been persisted.',
    requirementReference: 'deposit:commercial:finance-email:1',
    advisoryModelAllowed: true,
  };
}

test('Finance governed email preparation turns permitted model copy into an approval-gated Gmail task only', async () => {
  let draftCalls = 0;
  const service = createFinanceGovernedEmailPreparationService({
    communicationDraftService: {
      async draft(input) {
        draftCalls += 1;
        assert.equal(input.decision.state, 'AWAITING_VERIFIED_PAYMENT');
        return {
          policy: {
            intent: 'DRAFT_PAYMENT_VERIFICATION_REQUEST',
            operationalState: 'AWAITING_VERIFIED_PAYMENT',
            humanApprovalRequired: true as const,
            sendAuthorised: false as const,
            evidenceReferences: [],
          },
          draftText: 'Payment remains awaiting verification. Please share the provider reference if available.',
          evidenceReferences: ['model:gemini:test'],
          knowledgeReferences: ['atlas://finance/governance'],
        };
      },
    },
  });

  const task = await service.prepare({
    executionId: 'exec:finance-email:1',
    correlationId: 'corr:finance-email:1',
    decision: decision(),
    to: [{ email: 'client@example.test' }],
    subject: 'Payment verification',
    createdAt: '2026-08-23T10:00:00.000Z',
  });

  assert.equal(draftCalls, 1);
  assert.equal(task.destinationAgent, 'finance_agent');
  assert.equal(task.approvalRequired, true);
  assert.equal(task.approvalOwner, 'human_executive');
  assert.equal(task.nextAction, 'obtain_required_approval');
  assert.equal(task.inputs.fromIdentity, 'finance');
  assert.equal(task.inputs.subject, 'Payment verification');
  assert.equal(task.inputs.textBody, 'Payment remains awaiting verification. Please share the provider reference if available.');
  const communication = task.context.financeGovernedCommunication as Record<string, unknown>;
  assert.equal(communication.intent, 'DRAFT_PAYMENT_VERIFICATION_REQUEST');
  assert.equal(communication.sendAuthorised, false);
  const approval = task.context.financeEmailApprovalPolicy as Record<string, unknown>;
  assert.equal(approval.source, 'atlas_os');
});

test('Finance governed email preparation rejects any communication result that attempts to bypass Human Executive approval', async () => {
  const service = createFinanceGovernedEmailPreparationService({
    communicationDraftService: {
      async draft() {
        return {
          policy: {
            intent: 'DRAFT_PAYMENT_VERIFICATION_REQUEST',
            operationalState: 'AWAITING_VERIFIED_PAYMENT',
            humanApprovalRequired: true as const,
            sendAuthorised: true as never,
            evidenceReferences: [],
          },
          draftText: 'Unsafe direct-send attempt.',
          evidenceReferences: [],
          knowledgeReferences: [],
        };
      },
    },
  });

  await assert.rejects(
    () => service.prepare({
      executionId: 'exec:finance-email:unsafe',
      correlationId: 'corr:finance-email:unsafe',
      decision: decision(),
      to: [{ email: 'client@example.test' }],
      subject: 'Unsafe',
    }),
    /forbid direct send/,
  );
});
