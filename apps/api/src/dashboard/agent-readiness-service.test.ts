import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentReadinessService } from './agent-readiness-service.js';

const integrations = [
  'model.sandbox', 'payment.sandbox', 'payment.paystack', 'payment.paystack.request',
  'model.gemini', 'model.openai', 'model.anthropic', 'email.gmail',
  'research.google-places', 'research.tavily-web',
];

test('reports configured agents independently from runtime execution history', () => {
  const service = createAgentReadinessService({
    registeredIntegrationIds: integrations,
    controlPlaneConfigured: true,
    databaseConfigured: true,
    productionModelIntegrationId: 'model.anthropic',
    paymentIntegrationId: 'payment.paystack',
    paymentMode: 'sandbox',
  });

  const snapshot = service.snapshot();
  assert.equal(snapshot.length, 9);
  assert.equal(snapshot.find((item) => item.agentId === 'lead_agent')?.status, 'READY');
  assert.equal(snapshot.find((item) => item.agentId === 'production_agent')?.status, 'READY');
  assert.equal(snapshot.find((item) => item.agentId === 'finance_agent')?.status, 'DEGRADED');
});

test('fails closed when a required integration is missing', () => {
  const service = createAgentReadinessService({
    registeredIntegrationIds: integrations.filter((id) => id !== 'research.tavily-web'),
    controlPlaneConfigured: true,
    databaseConfigured: true,
  });

  const lead = service.snapshot().find((item) => item.agentId === 'lead_agent');
  assert.equal(lead?.status, 'NOT_CONFIGURED');
  assert.deepEqual(lead?.missingIntegrations, ['research.tavily-web']);
});

test('fails closed when control-plane authentication is unavailable', () => {
  const service = createAgentReadinessService({
    registeredIntegrationIds: integrations,
    controlPlaneConfigured: false,
    databaseConfigured: true,
  });

  assert.ok(service.snapshot().every((item) => item.status === 'NOT_CONFIGURED'));
});
