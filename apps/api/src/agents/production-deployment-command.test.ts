import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductionDeploymentAuthorityRecord } from '../data/production-deployment-authority-postgres-store.js';
import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { executeGovernedProductionDeployment } from './production-deployment-command.js';

const readyAuthority: ProductionDeploymentAuthorityRecord = {
  authorityId: 'deploy-auth-1',
  commercialRecordReference: 'commercial-1',
  projectName: 'client-site',
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
  evidenceReferences: ['qa:code:1', 'client:approval:1', 'finance:final-payment:1'],
  approvedBy: 'human_executive',
  approvedAt: '2026-08-25T19:40:00.000Z',
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

function authorityStore(record: ProductionDeploymentAuthorityRecord | null) {
  return { async get() { return record; } };
}

function governedInput(integrationRequest: IntegrationRequest = request()) {
  return {
    authorityId: 'deploy-auth-1',
    commercialRecordReference: 'commercial-1',
    projectName: 'client-site',
    integrationRequest,
  };
}

test('governed deployment blocks before provider execution when persisted authority is missing', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment(governedInput(), {
      integrations,
      deploymentAuthorityStore: authorityStore(null),
    }),
    /deployment authority was not found/,
  );
  assert.equal(providerCalls.count, 0);
});

test('governed deployment blocks before provider execution when persisted deployment gate is incomplete', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment(governedInput(), {
      integrations,
      deploymentAuthorityStore: authorityStore({ ...readyAuthority, securityChecked: false }),
    }),
    /Production deployment blocked: securityChecked/,
  );
  assert.equal(providerCalls.count, 0);
});

test('governed deployment rejects authority bound to another commercial record or project', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment(governedInput(), {
      integrations,
      deploymentAuthorityStore: authorityStore({ ...readyAuthority, commercialRecordReference: 'commercial-other' }),
    }),
    /commercial record does not match/,
  );
  await assert.rejects(
    () => executeGovernedProductionDeployment(governedInput(), {
      integrations,
      deploymentAuthorityStore: authorityStore({ ...readyAuthority, projectName: 'other-site' }),
    }),
    /project does not match/,
  );
  assert.equal(providerCalls.count, 0);
});

test('governed deployment executes provider only after persisted authority passes every deployment requirement', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  const response = await executeGovernedProductionDeployment(governedInput(), {
    integrations,
    deploymentAuthorityStore: authorityStore(readyAuthority),
  });

  assert.equal(response.status, 'succeeded');
  assert.equal(providerCalls.count, 1);
});

test('governed deployment refuses non-live mutations before authority lookup', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment(governedInput(request({ mode: 'sandbox' })), {
      integrations,
      deploymentAuthorityStore: authorityStore(readyAuthority),
    }),
    /require live integration mode/,
  );
  assert.equal(providerCalls.count, 0);
});

test('governed deployment refuses unauthorized agents before authority lookup', async () => {
  const providerCalls = { count: 0 };
  const integrations = registry(providerCalls);

  await assert.rejects(
    () => executeGovernedProductionDeployment(governedInput(request({ requestedBy: 'marketing_agent' })), {
      integrations,
      deploymentAuthorityStore: authorityStore(readyAuthority),
    }),
    /only be requested by Production or the Human Executive/,
  );
  assert.equal(providerCalls.count, 0);
});
