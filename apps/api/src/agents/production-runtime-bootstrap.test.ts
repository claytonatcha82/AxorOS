import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './production-model-capabilities.js';
import { createProductionRuntimeBootstrap } from './production-runtime-bootstrap.js';

class CountingModelIntegration implements ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  readonly integrationId = 'model.gemini';
  readonly kind = 'model' as const;
  readonly provider = 'bootstrap-test-model';
  readonly supportedModes = ['draft'] as const;
  readonly supportedOperations = ['generate_text'] as const;
  calls = 0;

  async execute(request: IntegrationRequest<ModelGenerationInput>): Promise<IntegrationResponse<ModelGenerationOutput>> {
    this.calls += 1;
    return {
      integrationId: this.integrationId,
      operation: request.operation,
      provider: this.provider,
      mode: request.mode,
      status: 'drafted',
      output: { text: 'governed implementation draft', model: 'bootstrap-test-model', finishReason: 'stop' },
      evidenceReferences: ['model:bootstrap-test:1'],
      retryable: false,
    };
  }
}

const clearanceRow = {
  clearance_id: 'clearance:bootstrap:1',
  commercial_record_reference: 'commercial:bootstrap:1',
  provider_payment_reference: 'pay:bootstrap:1',
  state: 'FINANCE_CLEARED',
  reason: 'Provider evidence matched.',
  evidence_references: ['payment-provider:bootstrap:event:1'],
  amount_minor: '10000',
  currency: 'ZAR',
  verified_at: new Date('2026-08-18T17:00:00.000Z'),
};

function productionTask(context: AgentRuntimeTask['context']): AgentRuntimeTask {
  const now = '2026-08-18T17:00:00.000Z';
  return {
    taskId: 'task-production-bootstrap',
    executionId: 'exec-production-bootstrap',
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Draft governed implementation',
    priority: 'normal',
    context,
    knowledgeReferences: [],
    inputs: { implementationBrief: 'Create the governed implementation draft.' },
    expectedOutput: 'Technical implementation draft',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 1,
    correlationId: 'corr-production-bootstrap',
    createdAt: now,
    updatedAt: now,
  };
}

function poolReturning(row: Record<string, unknown> | undefined): Pick<Pool, 'query'> {
  return {
    query: (async () => ({ rowCount: row ? 1 : 0, rows: row ? [row] : [] })) as Pool['query'],
  };
}

test('Production runtime bootstrap wires model handler to persisted Finance clearance', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);

  const runtime = createProductionRuntimeBootstrap({
    pool: poolReturning(clearanceRow),
    integrations,
  });

  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  const result = await handler.execute(productionTask({
    financeClearanceId: clearanceRow.clearance_id,
    commercialRecordReference: clearanceRow.commercial_record_reference,
  }));

  assert.equal(model.calls, 1);
  assert.equal(result.status, 'completed');
});

test('Production runtime bootstrap blocks model execution when persisted Finance clearance is missing', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);

  const runtime = createProductionRuntimeBootstrap({
    pool: poolReturning(undefined),
    integrations,
  });

  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  await assert.rejects(
    () => handler.execute(productionTask({
      financeClearanceId: 'clearance:missing',
      commercialRecordReference: 'commercial:bootstrap:1',
    })),
    /not found/,
  );
  assert.equal(model.calls, 0);
});
