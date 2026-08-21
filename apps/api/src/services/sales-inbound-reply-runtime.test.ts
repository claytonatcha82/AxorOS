import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { createSalesInboundReplyClassificationRecord } from './sales-inbound-reply-classification-contract.js';
import { createPersistedSalesInboundReplyRuntime } from './sales-inbound-reply-runtime.js';

function workflowRow() {
  return {
    id: 'sent-record-1', client_id: null, project_id: null,
    event_type: 'sales_supervised_email_sent', actor_type: 'agent', actor_id: 'sales_agent',
    payload: {
      leadId: 'lead-1', recipientEmail: 'owner@example.com', providerMessageId: 'outbound-1',
      providerThreadReference: 'thread-1', supervised: true, humanSendApprovalVerified: true, sendExecuted: true,
    },
    created_at: new Date('2026-08-21T12:00:00.000Z'),
  };
}

function evidenceRow(textBody: string) {
  return {
    id: '41', outbound_record_id: 'sent-record-1', lead_id: 'lead-1',
    provider_thread_reference: 'thread-1', provider_message_id: 'reply-1',
    sender_address: 'owner@example.com', recipient_address: 'sales@axoros.test',
    subject: 'Re: Website opportunity', provider_internal_date: '2000', snippet: textBody, text_body: textBody,
    recorded_at: new Date('2026-08-21T12:01:00.000Z'),
  };
}

function classificationRow(record: ReturnType<typeof createSalesInboundReplyClassificationRecord>) {
  return {
    inbound_evidence_id: record.inboundEvidenceId,
    outbound_record_id: record.outboundRecordId,
    lead_id: record.leadId,
    provider_message_id: record.providerMessageId,
    primary_category: record.primaryCategory,
    confidence: record.confidence ?? null,
    evidence_reasons: record.evidenceReasons,
    opt_out_detected: record.deterministicSignals.optOutDetected,
    automated_response_detected: record.deterministicSignals.automatedResponseDetected,
    delivery_failure_detected: record.deterministicSignals.deliveryFailureDetected,
    commercial_topic_detected: record.commercialTopicDetected,
    sensitive_topic_detected: record.sensitiveTopicDetected,
    uncertainty_detected: record.uncertaintyDetected,
    classification_source: record.classificationSource,
    model_reference: record.modelReference ?? null,
    response_authorised: false as const,
    pricing_authorised: false as const,
    discount_authorised: false as const,
    commercial_commitment_authorised: false as const,
    contract_authorised: false as const,
    next_action: record.nextAction,
    human_review_required: record.humanReviewRequired,
    classified_at: new Date(record.classifiedAt),
  };
}

function gmailFor(textBody: string) {
  return {
    async readThread(threadReference: string) {
      return {
        threadReference,
        messages: [
          { messageId: 'outbound-1', threadReference, from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000' },
          { messageId: 'reply-1', threadReference, from: 'owner@example.com', to: 'sales@axoros.test', internalDate: '2000', subject: 'Re: Website opportunity', snippet: textBody, textBody },
        ],
      };
    },
  };
}

test('composes persisted repository with the configured Gmail thread reader for inspection', async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (/from operational\.workflow_events where id = \$1/i.test(sql)) return { rows: [workflowRow()] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as Pool;
  const reads: string[] = [];
  const gmail = {
    async readThread(threadReference: string) {
      reads.push(threadReference);
      return gmailFor('Interested.').readThread(threadReference);
    },
  };

  const runtime = createPersistedSalesInboundReplyRuntime(pool, gmail);
  const result = await runtime.commands.inspect('sent-record-1');

  assert.equal(queries.length, 1);
  assert.deepEqual(reads, ['thread-1']);
  assert.equal(result.replyDetected, true);
  assert.equal(result.reply?.messageId, 'reply-1');
  assert.equal(result.automaticResponseAuthorised, false);
});

test('persists deterministic opt-out classification without invoking OpenAI', async () => {
  const textBody = 'Please unsubscribe me and do not contact me again.';
  let modelCalls = 0;
  const classifications: any[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      if (/from operational\.workflow_events where id = \$1/i.test(sql)) return { rows: [workflowRow()] };
      if (/insert into operational\.sales_inbound_reply_evidence/i.test(sql)) return { rows: [evidenceRow(textBody)] };
      if (/insert into operational\.sales_inbound_reply_classifications/i.test(sql)) {
        const record = createSalesInboundReplyClassificationRecord({
          inboundEvidenceId: String(params?.[0]), outboundRecordId: String(params?.[1]), leadId: String(params?.[2]), providerMessageId: String(params?.[3]),
          primaryCategory: String(params?.[4]) as 'opt_out', evidenceReasons: JSON.parse(String(params?.[6])),
          deterministicSignals: { optOutDetected: Boolean(params?.[7]), automatedResponseDetected: Boolean(params?.[8]), deliveryFailureDetected: Boolean(params?.[9]) },
          commercialTopicDetected: Boolean(params?.[10]), sensitiveTopicDetected: Boolean(params?.[11]), uncertaintyDetected: Boolean(params?.[12]),
          classificationSource: String(params?.[13]) as 'deterministic', nextAction: String(params?.[15]) as 'record_suppression',
          humanReviewRequired: Boolean(params?.[16]), classifiedAt: String(params?.[17]),
        });
        classifications.push(record);
        return { rows: [classificationRow(record)] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as Pool;
  const runtime = createPersistedSalesInboundReplyRuntime(pool, gmailFor(textBody), {
    async classify() { modelCalls += 1; throw new Error('OpenAI must not be called for opt-out.'); },
  });

  const result = await runtime.commands.inspectPersistAndClassify('sent-record-1');
  assert.equal(modelCalls, 0);
  assert.equal(classifications.length, 1);
  assert.equal(result.classificationRecorded, true);
  assert.equal(result.classification?.primaryCategory, 'opt_out');
  assert.equal(result.classification?.classificationSource, 'deterministic');
  assert.equal(result.classification?.responseAuthorised, false);
});

test('uses model classifier only after deterministic checks and persists its classification', async () => {
  const textBody = 'Yes, please tell me more about the website service.';
  const modelEvidence: any[] = [];
  const pool = {
    async query(sql: string) {
      if (/from operational\.workflow_events where id = \$1/i.test(sql)) return { rows: [workflowRow()] };
      if (/insert into operational\.sales_inbound_reply_evidence/i.test(sql)) return { rows: [evidenceRow(textBody)] };
      if (/insert into operational\.sales_inbound_reply_classifications/i.test(sql)) {
        const record = modelClassification();
        return { rows: [classificationRow(record)] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as Pool;
  const modelClassification = () => createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: '41', outboundRecordId: 'sent-record-1', leadId: 'lead-1', providerMessageId: 'reply-1',
    primaryCategory: 'positive_interest', evidenceReasons: [{ reason: 'Sender explicitly asks for more information.' }],
    deterministicSignals: { optOutDetected: false, automatedResponseDetected: false, deliveryFailureDetected: false },
    commercialTopicDetected: false, sensitiveTopicDetected: false, uncertaintyDetected: false,
    classificationSource: 'model_assisted', modelReference: 'gpt-5.6-terra', nextAction: 'prepare_sales_response',
    humanReviewRequired: true, classifiedAt: '2026-08-21T12:02:00.000Z',
  });
  const runtime = createPersistedSalesInboundReplyRuntime(pool, gmailFor(textBody), {
    async classify(evidence) { modelEvidence.push(evidence); return modelClassification(); },
  });

  const result = await runtime.commands.inspectPersistAndClassify('sent-record-1');
  assert.equal(modelEvidence.length, 1);
  assert.equal(modelEvidence[0].inboundEvidenceId, '41');
  assert.equal(modelEvidence[0].providerMessageId, 'reply-1');
  assert.equal(modelEvidence[0].bodyOrSnippet, textBody);
  assert.equal(result.classificationRecorded, true);
  assert.equal(result.classification?.primaryCategory, 'positive_interest');
  assert.equal(result.classification?.classificationSource, 'model_assisted');
  assert.equal(result.classification?.modelReference, 'gpt-5.6-terra');
  assert.equal(result.classification?.responseAuthorised, false);
});
