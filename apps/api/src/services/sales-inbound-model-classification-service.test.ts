import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import {
  createSalesInboundModelClassificationService,
  SALES_INBOUND_MODEL_ALLOWED_CATEGORIES,
} from './sales-inbound-model-classification-service.js';

function modelReturning(payload: unknown): ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  return {
    integrationId: 'model.openai',
    kind: 'model',
    provider: 'openai',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      assert.equal(request.integrationId, 'model.openai');
      assert.equal(request.mode, 'draft');
      assert.equal(request.operation, 'generate_text');
      return {
        integrationId: 'model.openai',
        operation: 'generate_text',
        provider: 'openai',
        mode: 'draft',
        status: 'drafted',
        output: {
          text: JSON.stringify(payload),
          model: 'gpt-5.6-terra',
          finishReason: 'stop',
        },
        evidenceReferences: ['openai:test'],
        retryable: false,
      };
    },
  };
}

const evidence = {
  inboundEvidenceId: 'evidence-1',
  outboundRecordId: 'outbound-1',
  leadId: 'lead-1',
  providerMessageId: 'gmail-message-1',
  senderAddress: 'prospect@example.com',
  subject: 'Re: Website services',
  bodyOrSnippet: 'Yes, I would like to know more about the website service.',
};

test('model classifier is limited to non-deterministic Atlas categories', () => {
  assert.deepEqual(SALES_INBOUND_MODEL_ALLOWED_CATEGORIES, [
    'positive_interest',
    'information_request',
    'pricing_or_commercial_question',
    'meeting_request',
    'objection',
    'not_interested',
    'ambiguous',
    'sensitive_or_high_risk',
  ]);
});

test('classifies positive interest through OpenAI without granting response authority', async () => {
  const service = createSalesInboundModelClassificationService(modelReturning({
    primaryCategory: 'positive_interest',
    evidenceReasons: [{ reason: 'Sender explicitly said they would like to know more.' }],
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: false,
  }));

  const record = await service.classify(evidence);
  assert.equal(record.primaryCategory, 'positive_interest');
  assert.equal(record.classificationSource, 'model_assisted');
  assert.equal(record.modelReference, 'gpt-5.6-terra');
  assert.equal(record.nextAction, 'prepare_sales_response');
  assert.equal(record.humanReviewRequired, true);
  assert.equal(record.responseAuthorised, false);
  assert.equal(record.pricingAuthorised, false);
  assert.equal(record.discountAuthorised, false);
  assert.equal(record.commercialCommitmentAuthorised, false);
  assert.equal(record.contractAuthorised, false);
  assert.equal(record.confidence, undefined);
});

test('ambiguous model result explicitly requires uncertainty and human review', async () => {
  const service = createSalesInboundModelClassificationService(modelReturning({
    primaryCategory: 'ambiguous',
    evidenceReasons: [{ reason: 'The message only says okay and does not establish intent.' }],
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: false,
  }));

  const record = await service.classify({ ...evidence, bodyOrSnippet: 'Okay.' });
  assert.equal(record.primaryCategory, 'ambiguous');
  assert.equal(record.uncertaintyDetected, true);
  assert.equal(record.humanReviewRequired, true);
  assert.equal(record.nextAction, 'human_review_required');
});

test('high-risk model result forces sensitive signal and Human Executive routing', async () => {
  const service = createSalesInboundModelClassificationService(modelReturning({
    primaryCategory: 'sensitive_or_high_risk',
    evidenceReasons: [{ reason: 'Sender raises a legal complaint.' }],
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: false,
  }));

  const record = await service.classify({
    ...evidence,
    bodyOrSnippet: 'Your emails violate the law and I am reporting your company.',
  });
  assert.equal(record.sensitiveTopicDetected, true);
  assert.equal(record.nextAction, 'route_to_human_executive_or_appropriate_owner');
  assert.equal(record.responseAuthorised, false);
});

test('classifier guidance reserves high-risk commercial flag for Finance-owned financial administration', async () => {
  const model = modelReturning({
    primaryCategory: 'sensitive_or_high_risk',
    evidenceReasons: [{ reason: 'Sender claims an invoice was already paid.' }],
    commercialTopicDetected: true,
    sensitiveTopicDetected: true,
    uncertaintyDetected: false,
  });
  const originalExecute = model.execute.bind(model);
  model.execute = async (request) => {
    const instruction = request.input.systemInstruction ?? '';
    assert.match(instruction, /Finance-owned financial administration/);
    assert.match(instruction, /Sales must not confirm payment/);
    assert.match(instruction, /Exceptional discounts, bespoke terms/);
    return originalExecute(request);
  };

  const service = createSalesInboundModelClassificationService(model);
  const record = await service.classify({ ...evidence, bodyOrSnippet: 'I already paid the invoice.' });
  assert.equal(record.primaryCategory, 'sensitive_or_high_risk');
  assert.equal(record.commercialTopicDetected, true);
  assert.equal(record.responseAuthorised, false);
});

test('model cannot return deterministic safety categories', async () => {
  const service = createSalesInboundModelClassificationService(modelReturning({
    primaryCategory: 'opt_out',
    evidenceReasons: [{ reason: 'Model attempted deterministic category.' }],
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: false,
  }));
  await assert.rejects(() => service.classify(evidence), /unsupported category/);
});

test('invalid model JSON fails closed', async () => {
  const model = modelReturning({});
  model.execute = async () => ({
    integrationId: 'model.openai',
    operation: 'generate_text',
    provider: 'openai',
    mode: 'draft',
    status: 'drafted',
    output: { text: 'not-json', model: 'gpt-5.6-terra', finishReason: 'stop' },
    evidenceReferences: ['openai:test'],
    retryable: false,
  });
  const service = createSalesInboundModelClassificationService(model);
  await assert.rejects(() => service.classify(evidence), /valid JSON/);
});

test('rejects a model integration outside the governed OpenAI boundary', () => {
  const model = modelReturning({});
  model.integrationId = 'model.gemini';
  assert.throws(() => createSalesInboundModelClassificationService(model), /model\.openai/);
});
