import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProductionDeploymentAuthorityRecord } from '../data/production-deployment-authority-postgres-store.js';
import type { ExternalIntegration, IntegrationResponse } from '../integrations/integration-contract.js';
import type { DeploymentStatusOutput } from '../integrations/deployment-provider-contract.js';
import type { CloudflareProductionDeploymentInput } from '../integrations/cloudflare-production-deployment-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { executeGovernedProductionBuildDeployment } from './production-build-deployment-command.js';

const readyAuthority: ProductionDeploymentAuthorityRecord = {
  authorityId: 'deploy-auth-production-1',
  commercialRecordReference: 'commercial-production-1',
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
  evidenceReferences: ['qa:all:1', 'client:approval:1', 'finance:final-payment:1', 'rollback:ready:1'],
  approvedBy: 'human_executive',
  approvedAt: '2026-08-26T07:00:00.000Z',
};

function registry(capture: { calls: number; input?: unknown }): IntegrationRegistry {
  const registry = new IntegrationRegistry({
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    scopedLiveRules: [{ integrationId: 'deployment.cloudflare.production', operation: 'deploy_production', riskCeiling: 'critical' }],
  });
  const integration: ExternalIntegration<CloudflareProductionDeploymentInput, DeploymentStatusOutput> = {
    integrationId: 'deployment.cloudflare.production',
    kind: 'deployment',
    provider: 'cloudflare',
    supportedModes: ['live'],
    supportedOperations: ['deploy_production'],
    async execute(request): Promise<IntegrationResponse<DeploymentStatusOutput>> {
      capture.calls += 1;
      capture.input = request.input;
      return {
        integrationId: request.integrationId,
        operation: request.operation,
        provider: 'cloudflare',
        mode: request.mode,
        status: 'succeeded',
        output: {
          projectName: 'client-site',
          deploymentId: 'deployment-production-1',
          environment: 'production',
          status: 'ready',
        },
        evidenceReferences: ['cloudflare:pages:production:deployment-production-1'],
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

test('packages a real build directory and executes production only after strict persisted authority passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoros-production-build-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<html><body>AxorOS</body></html>');
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("ready")');

    const capture: { calls: number; input?: unknown } = { calls: 0 };
    const result = await executeGovernedProductionBuildDeployment({
      authorityId: readyAuthority.authorityId,
      commercialRecordReference: readyAuthority.commercialRecordReference,
      projectName: readyAuthority.projectName,
      productionBranch: 'main',
      buildOutputDirectory: root,
      executionId: 'exec-production-1',
      correlationId: 'corr-production-1',
      idempotencyKey: 'production:client-site:1',
      requestedBy: 'human_executive',
      commitHash: 'abc123',
      commitMessage: 'Approved production release',
    }, {
      integrations: registry(capture),
      deploymentAuthorityStore: authorityStore(readyAuthority),
    });

    assert.equal(result.deployment.status, 'succeeded');
    assert.equal(result.packagedFileCount, 2);
    assert.ok(result.packagedBytes > 0);
    assert.equal(capture.calls, 1);
    const providerInput = capture.input as CloudflareProductionDeploymentInput;
    assert.equal(providerInput.projectName, 'client-site');
    assert.equal(providerInput.productionBranch, 'main');
    assert.deepEqual(providerInput.assets.map((asset) => asset.path), ['/assets/app.js', '/index.html']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('strict persisted deployment authority blocks before provider execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoros-production-blocked-'));
  try {
    await writeFile(join(root, 'index.html'), '<html></html>');
    const capture = { calls: 0 };

    await assert.rejects(
      () => executeGovernedProductionBuildDeployment({
        authorityId: readyAuthority.authorityId,
        commercialRecordReference: readyAuthority.commercialRecordReference,
        projectName: readyAuthority.projectName,
        productionBranch: 'main',
        buildOutputDirectory: root,
        executionId: 'exec-production-2',
        correlationId: 'corr-production-2',
        idempotencyKey: 'production:client-site:2',
        requestedBy: 'production_agent',
      }, {
        integrations: registry(capture),
        deploymentAuthorityStore: authorityStore({ ...readyAuthority, clientApproved: false }),
      }),
      /Production deployment blocked: clientApproved/,
    );

    assert.equal(capture.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
