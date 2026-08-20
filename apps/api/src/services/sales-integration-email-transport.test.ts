import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExternalIntegration, IntegrationRequest } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createSalesIntegrationEmailTransport } from './sales-integration-email-transport.js';

function liveSalesPolicy() {
  return {
    defaultMode: 'sandbox' as const,
    allowLive: false,
    liveRiskCeiling: 'low' as const,
    liveOperationRules: [
      { integrationId: 'email.gmail', operation: 'send_email', riskCeiling: 'medium' as const },
    ],
  };
}

function registryHarness() {
  const requests: IntegrationRequest[] = [];
  const registry = new IntegrationRegistry(liveSalesPolicy());

  const integration: ExternalIntegration = {
    integrationId: 'email.gmail',
    kind: 'email',
    provider: 'google-gmail-test',
    supportedModes: ['draft', 'live'],
    supportedOperations: ['create_draft', 'send_email'],
    async execute(request) {
      requests.push(request);
      return {
        integrationId: request.integrationId,
        operation: request.operation,
        provider: 'google-gmail-test',
        mode: request.mode,
        status: 'succeeded',
        output: {
          messageId: 'gmail-message-1',
          fromIdentity: 'sales',
          recipients: ['owner@example.com'],
          subject: 'Website opportunity',
          preview: 'Hello from AxorOS',
        },
        externalReference: 'gmail-message-1',
        evidenceReferences: ['gmail:message:gmail-message-1'],
        retryable: false,
      };
    },
  };

  registry.register(integration);
  return { registry, requests };
}

const message = { to: 'owner@example.com', subject: 'Website opportunity', body: 'Hello from AxorOS' };
const context = {
  sendGateRecordId: 'gate-1',
  executionId: 'sales-supervised-email-send:gate-1',
  correlationId: 'lead-1',
  idempotencyKey: 'sales-supervised-email-send:gate-1',
};

test('bridges supervised Sales message to the existing Gmail integration contract', async () => {
  const { registry, requests } = registryHarness();
  const transport = createSalesIntegrationEmailTransport(registry);

  const result = await transport.send(message, context);

  assert.deepEqual(result, { providerMessageId: 'gmail-message-1' });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    integrationId: 'email.gmail',
    operation: 'send_email',
    requestedBy: 'sales_agent',
    executionId: 'sales-supervised-email-send:gate-1',
    correlationId: 'lead-1',
    mode: 'live',
    risk: 'medium',
    idempotencyKey: 'sales-supervised-email-send:gate-1',
    input: {
      fromIdentity: 'sales',
      to: [{ email: 'owner@example.com' }],
      subject: 'Website opportunity',
      textBody: 'Hello from AxorOS',
    },
  });
});

test('does not bypass the integration registry live policy', async () => {
  const registry = new IntegrationRegistry();
  registry.register({
    integrationId: 'email.gmail',
    kind: 'email',
    provider: 'google-gmail-test',
    supportedModes: ['live'],
    supportedOperations: ['send_email'],
    async execute(request) {
      return {
        integrationId: request.integrationId,
        operation: request.operation,
        provider: 'google-gmail-test',
        mode: request.mode,
        status: 'succeeded',
        output: {},
        evidenceReferences: [],
        retryable: false,
      };
    },
  });

  const transport = createSalesIntegrationEmailTransport(registry);
  await assert.rejects(
    () => transport.send(message, context),
    /live integration execution is disabled by policy/,
  );
});

test('rejects a provider success without a message id', async () => {
  const registry = new IntegrationRegistry(liveSalesPolicy());
  registry.register({
    integrationId: 'email.gmail',
    kind: 'email',
    provider: 'google-gmail-test',
    supportedModes: ['live'],
    supportedOperations: ['send_email'],
    async execute(request) {
      return {
        integrationId: request.integrationId,
        operation: request.operation,
        provider: 'google-gmail-test',
        mode: request.mode,
        status: 'succeeded',
        output: {
          fromIdentity: 'sales',
          recipients: ['owner@example.com'],
          subject: 'Website opportunity',
          preview: 'missing provider id',
        },
        evidenceReferences: [],
        retryable: false,
      };
    },
  });

  const transport = createSalesIntegrationEmailTransport(registry);
  await assert.rejects(() => transport.send(message, context), /providerMessageId is required/);
});
