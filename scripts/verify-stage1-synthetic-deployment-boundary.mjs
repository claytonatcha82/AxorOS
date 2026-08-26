import assert from 'node:assert/strict';

import { executeGovernedProductionDeployment } from '../apps/api/dist/agents/production-deployment-command.js';
import { createCloudflareProductionDeploymentIntegration } from '../apps/api/dist/integrations/cloudflare-production-deployment-integration.js';
import { createPilotLiveExecutionGate } from '../apps/api/dist/integrations/pilot-live-execution-gate.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:stage1:synthetic:${suffix}`;
const correlationId = `corr:stage1:synthetic:${suffix}`;
const authorityId = `deployment-authority:stage1:synthetic:${suffix}`;
const projectName = `axoros-stage1-synthetic-${suffix.slice(-12)}`;
const now = new Date().toISOString();

console.log('\nAxorOS Stage 1 — Synthetic Deployment Authority → Pilot Kill Switch');
console.log('=================================================================');
console.log('Synthetic scenario only. Cloudflare network execution must remain at zero.\n');

const authority = {
  authorityId,
  commercialRecordReference,
  projectName,
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
  evidenceReferences: [
    `stage1:${correlationId}:code-qa`,
    `stage1:${correlationId}:functional-qa`,
    `stage1:${correlationId}:visual-qa`,
    `stage1:${correlationId}:business-qa`,
    `stage1:${correlationId}:client-approval`,
    `stage1:${correlationId}:final-payment-condition`,
    `stage1:${correlationId}:rollback-ready`,
    `stage1:${correlationId}:seo-check`,
    `stage1:${correlationId}:security-check`,
    `stage1:${correlationId}:deployment-approval`,
  ],
  approvedBy: 'human_executive:stage1-synthetic',
  approvedAt: now,
};

const authorityStore = {
  async get(id) {
    return id === authorityId ? authority : null;
  },
};

const pilotStateStore = {
  async get() {
    return {
      singletonKey: true,
      state: 'PILOT_DISABLED',
      changedAt: now,
      changedBy: 'human_executive:stage1-synthetic',
      reason: 'Stage 1 synthetic simulation must remain fail closed.',
    };
  },
};

let cloudflareNetworkCalls = 0;
const cloudflare = createCloudflareProductionDeploymentIntegration({
  accountId: 'stage1-synthetic-account',
  apiToken: 'stage1-synthetic-token',
  baseUrl: 'https://cloudflare.invalid',
  fetchImpl: async () => {
    cloudflareNetworkCalls += 1;
    throw new Error('Stage 1 safety violation: Cloudflare network execution occurred.');
  },
});

const integrations = new IntegrationRegistry({
  defaultMode: 'sandbox',
  allowLive: false,
  liveRiskCeiling: 'low',
  scopedLiveRules: [
    {
      integrationId: 'deployment.cloudflare.production',
      operation: 'deploy_production',
      riskCeiling: 'critical',
    },
  ],
});
integrations.setLiveExecutionGate(createPilotLiveExecutionGate(pilotStateStore));
integrations.register(cloudflare);

const asset = {
  path: '/index.html',
  contentHash: '0123456789abcdef0123456789abcdef',
  contentType: 'text/html; charset=utf-8',
  contentBase64: Buffer.from('<html><body>AxorOS Stage 1 Synthetic</body></html>').toString('base64'),
};

const request = {
  authorityId,
  commercialRecordReference,
  projectName,
  integrationRequest: {
    integrationId: 'deployment.cloudflare.production',
    operation: 'deploy_production',
    requestedBy: 'production_agent',
    executionId: `exec:stage1:synthetic:deployment:${suffix}`,
    correlationId,
    mode: 'live',
    risk: 'critical',
    idempotencyKey: `stage1:synthetic:deploy-production:${suffix}`,
    input: {
      projectName,
      productionBranch: 'main',
      assets: [asset],
      buildOutputDirectory: 'dist',
    },
  },
};

console.log('[1] Strict Production deployment authority assembled.');
console.log(`    authorityId: ${authorityId}`);
console.log(`    commercialRecordReference: ${commercialRecordReference}`);

let blockedError;
try {
  await executeGovernedProductionDeployment(request, {
    integrations,
    deploymentAuthorityStore: authorityStore,
  });
  assert.fail('Expected PILOT_DISABLED to block production deployment.');
} catch (error) {
  blockedError = error;
}

assert.ok(blockedError instanceof Error);
assert.match(
  blockedError.message,
  /deployment\.cloudflare\.production\/deploy_production blocked while pilot state is PILOT_DISABLED/,
);
assert.equal(
  cloudflareNetworkCalls,
  0,
  'Cloudflare provider was reached despite PILOT_DISABLED.',
);

console.log('[2] Deployment request passed strict internal authority checks.');
console.log('[3] Global PilotLiveExecutionGate blocked live Cloudflare production execution.');
console.log('    pilotState: PILOT_DISABLED');
console.log(`    cloudflareNetworkCalls: ${cloudflareNetworkCalls}`);
console.log(`    correlationId: ${correlationId}`);

console.log('\nPASS  Strict synthetic Production deployment authority reached the global pilot boundary and PILOT_DISABLED prevented all Cloudflare network execution.\n');
