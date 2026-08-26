import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IntegrationRequest } from '../integrations/integration-contract.js';
import type { GovernedPreviewDeploymentDependencies } from './production-preview-deployment-command.js';
import { executeGovernedPreviewBuildDeployment } from './production-preview-build-deployment-command.js';

function readyDependencies(captured: { request?: IntegrationRequest }): GovernedPreviewDeploymentDependencies {
  return {
    integrations: {
      get(id: string) {
        return id === 'deployment.cloudflare.preview'
          ? { integrationId: id, kind: 'deployment', provider: 'cloudflare', supportedModes: ['live'], supportedOperations: ['create_preview_deployment'], execute: async () => { throw new Error('not used directly'); } }
          : undefined;
      },
      async execute(request: IntegrationRequest) {
        captured.request = request;
        return {
          integrationId: request.integrationId,
          operation: request.operation,
          provider: 'cloudflare',
          mode: request.mode,
          status: 'succeeded',
          output: { projectName: 'client-site', deploymentId: 'deployment-1', environment: 'preview', status: 'ready', url: 'https://preview.pages.dev' },
          evidenceReferences: ['cloudflare:pages:preview:deployment-1'],
          retryable: false,
        };
      },
    },
    financeClearanceStore: {
      async get() {
        return {
          clearanceId: 'clearance-1', commercialRecordReference: 'commercial-1', providerPaymentReference: 'payment-1',
          state: 'FINANCE_CLEARED', reason: 'confirmed', evidenceReferences: ['payment-provider:paystack:payment-1'],
          amountMinor: 10000, currency: 'ZAR', verifiedAt: '2026-08-25T20:00:00.000Z',
        };
      },
    },
    financePaymentStateStore: {
      async get() {
        return {
          provider: 'paystack', providerPaymentReference: 'payment-1', commercialRecordReference: 'commercial-1',
          paymentStatus: 'CONFIRMED', authorityState: 'AUTHORIZED', reason: 'confirmed', latestEventType: 'charge.success',
          latestProviderEventReference: 'event-1', latestEvidenceReference: 'evidence-1', latestOccurredAt: '2026-08-25T20:00:00.000Z',
          amountMinor: 10000, currency: 'ZAR',
        };
      },
    },
    commercialPaymentRequirementStore: {
      async get() {
        return {
          requirementReference: 'requirement-1', commercialRecordReference: 'commercial-1', gate: 'PRODUCTION_START',
          requiredAmountMinor: 10000, currency: 'ZAR', status: 'SATISFIED', createdAt: '2026-08-25T19:00:00.000Z',
        };
      },
    },
    commercialPaymentSatisfactionStore: {
      async get() {
        return {
          requirementReference: 'requirement-1', clearanceId: 'clearance-1', commercialRecordReference: 'commercial-1',
          gate: 'PRODUCTION_START', satisfiedAt: '2026-08-25T20:00:00.000Z',
        };
      },
    },
    operationsReadinessStore: {
      async get() {
        return {
          readinessId: 'operations-1', commercialRecordReference: 'commercial-1', state: 'OPERATIONS_READY',
          contractSigned: true, onboardingComplete: true, assetsAvailable: true, planningComplete: true,
          evidenceReferences: ['operations:onboarding:complete'], approvedBy: 'human_executive', approvedAt: '2026-08-25T20:00:00.000Z',
        };
      },
    },
  } as unknown as GovernedPreviewDeploymentDependencies;
}

test('packages a build directory and forwards deterministic assets through the governed preview command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoros-build-preview-'));
  const captured: { request?: IntegrationRequest } = {};
  try {
    await writeFile(join(root, 'index.html'), '<html>client</html>');

    const result = await executeGovernedPreviewBuildDeployment({
      commercialRecordReference: 'commercial-1',
      financeClearanceId: 'clearance-1',
      operationsReadinessId: 'operations-1',
      projectName: 'client-site',
      productionBranch: 'main',
      previewBranch: 'axoros-preview-1',
      buildOutputDirectory: root,
      executionId: 'execution-1',
      correlationId: 'correlation-1',
      idempotencyKey: 'preview:client-site:1',
      requestedBy: 'production_agent',
      commitHash: 'abc123',
      commitMessage: 'Pilot preview',
    }, readyDependencies(captured));

    assert.equal(result.packagedFileCount, 1);
    assert.ok(result.packagedBytes > 0);
    assert.equal(result.deployment.status, 'succeeded');
    assert.equal(captured.request?.integrationId, 'deployment.cloudflare.preview');
    assert.equal(captured.request?.operation, 'create_preview_deployment');
    const input = captured.request?.input as { assets?: Array<{ path: string; contentHash: string; contentBase64: string }>; previewBranch?: string };
    assert.equal(input.previewBranch, 'axoros-preview-1');
    assert.equal(input.assets?.[0]?.path, '/index.html');
    assert.match(input.assets?.[0]?.contentHash ?? '', /^[a-f0-9]{32}$/);
    assert.equal(Buffer.from(input.assets?.[0]?.contentBase64 ?? '', 'base64').toString('utf8'), '<html>client</html>');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects an invalid build directory before any provider execution', async () => {
  const captured: { request?: IntegrationRequest } = {};
  await assert.rejects(
    () => executeGovernedPreviewBuildDeployment({
      commercialRecordReference: 'commercial-1', financeClearanceId: 'clearance-1', operationsReadinessId: 'operations-1',
      projectName: 'client-site', productionBranch: 'main', previewBranch: 'preview',
      buildOutputDirectory: join(tmpdir(), 'axoros-missing-preview-build'), executionId: 'execution-2', correlationId: 'correlation-2',
      idempotencyKey: 'preview:missing', requestedBy: 'production_agent',
    }, readyDependencies(captured)),
    /was not found or is not a directory/,
  );
  assert.equal(captured.request, undefined);
});
