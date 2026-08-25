import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { executeGovernedProductionDeployment } from './production-deployment-command.js';
import type { ProductionDeploymentGateInput } from './production-deployment-gate.js';

const readyGate: ProductionDeploymentGateInput = {
  codeQaPassed: true,
  functionalQaPassed: true,
  visualQaPassed: true,
  businessQaPassed: true,
  clientApproved: true,
  requiredFinalPaymentConditionMet: true,
  rollbackPrepared: true,
  seoChecked: true,
  securityChecked: true,
  deploymentApproved: true,
};

function request(overrides: Partial<IntegrationRequest> = {}): IntegrationRequest {
  return {
    integrationId: 'deployment.test',
    operation: 'promote_to_production',
    requestedBy: 'production_agent',
    executionId: 'deploy-exec-1',
    correlationId: 'deploy-corr-1',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'deployment:deploy-exec-1:promote',
    input: { projectName: 'client-site' },
    ...overrides,
  };
}

function registry(providerCalls: { count: number }): IntegrationRegistry {
  const registry = new IntegrationRegistry({
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    scopedLiveRules: [{ integrationId: 'deployment.test', operation: 'promote_to_production', riskCeiling: 'high' }],
  });
  const integration: ExternalIntegration = {
    integrationId: 'deployment.test',
    kind: 'deployment',
    provider: 'test-deployment',
    supportedModes: ['live'],
    supportedOperations: ['promote_to_production'],
    async execute(input): Promise<IntegrationResponse> {
      providerCalls.count += 1;
      return {
        integrationId: input.integrationId,
        operation: input.operation,
        provider: 'test-deployment',
        mode: input.mode,
        status: 'succeeded',
        output: { promoted: true },
        evidenceReferences: ['deployment:test:1'],
        retryable: false,
      };
    },
  };
  registry.register(integration);
  return registry;
}

test('governed deployment blocks before provider execution when deployment gate is incomplete', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment({
      gate: { ...readyGate, securityChecked: false },
      integrationRequest: request(),
    }, { integrations }),
    /Production deployment blocked: securityChecked/,
  );
  assert.equal(providerCalls.count, 0);
});

test('governed deployment executes provider only after every deployment requirement passes', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  const response = await executeGovernedProductionDeployment({
    gate: readyGate,
    integrationRequest: request(),
  }, { integrations });

  assert.equal(response.status, 'succeeded');
  assert.equal(providerCalls.count, 1);
});

test('governed deployment refuses non-live mutations before provider execution', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment({
      gate: readyGate,
      integrationRequest: request({ mode: 'sandbox' }),
    }, { integrations }),
    /require live integration mode/,
  );
  assert.equal(providerCalls.count, 0);
});

test('governed deployment refuses unauthorized agents before provider execution', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment({
      gate: readyGate,
      integrationRequest: request({ requestedBy: 'marketing_agent' }),
    }, { integrations }),
    /only be requested by Production or the Human Executive/,
  );
  assert.equal(providerCalls.count, 0);
});
