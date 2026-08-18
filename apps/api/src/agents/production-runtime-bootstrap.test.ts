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

const paymentStateRow = {
  provider: 'bootstrap',
  provider_payment_reference: 'pay:bootstrap:1',
  commercial_record_reference: 'commercial:bootstrap:1',
  payment_status: 'CONFIRMED',
  authority_state: 'AUTHORIZED',
  reason: 'Verified provider payment confirmation supports Finance authorization.',
  latest_event_type: 'payment_paid',
  latest_provider_event_reference: 'event:1',
  latest_evidence_reference: 'payment-provider:bootstrap:event:1',
  latest_occurred_at: new Date('2026-08-18T17:00:00.000Z'),
  amount_minor: '10000',
  currency: 'ZAR',
};

const requirementRow = {
  commercial_record_reference: 'commercial:bootstrap:1',
  gate: 'PRODUCTION_START',
  requirement_reference: 'deposit:bootstrap:1',
  requirement_type: 'DEPOSIT',
  required_amount_minor: '10000',
  currency: 'ZAR',
  status: 'ACTIVE',
};

function productionTask(context: AgentRuntimeTask['context']): AgentRuntimeTask {
  const now = '2026-08-18T17:00:00.000Z';
  return {
    taskId: 'task-production-bootstrap', executionId: 'exec-production-bootstrap', originAgent: 'operations_agent',
    destinationAgent: 'production_agent', objective: 'Draft governed implementation', priority: 'normal', context,
    knowledgeReferences: [], inputs: { implementationBrief: 'Create the governed implementation draft.' },
    expectedOutput: 'Technical implementation draft', dependencies: [], risks: [], confidence: 1,
    approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1,
    maxAttempts: 1, correlationId: 'corr-production-bootstrap', createdAt: now, updatedAt: now,
  };
}

function poolReturning(options: {
  clearance?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  requirement?: Record<string, unknown>;
}): Pick<Pool, 'query'> {
  return {
    query: (async (sql: string) => {
      const row = sql.includes('finance.clearance_decisions') ? options.clearance
        : sql.includes('finance.commercial_payment_requirements') ? options.requirement
          : sql.includes('finance.payment_current_state') ? options.payment
            : undefined;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }) as unknown as Pool['query'],
  };
}

function validOptions() {
  return { clearance: clearanceRow, payment: paymentStateRow, requirement: requirementRow };
}

test('Production runtime bootstrap wires model handler to clearance, commercial requirement and current payment authority', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const runtime = createProductionRuntimeBootstrap({ pool: poolReturning(validOptions()), integrations });
  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  const result = await handler.execute(productionTask({
    financeClearanceId: clearanceRow.clearance_id,
    commercialRecordReference: clearanceRow.commercial_record_reference,
  }));
  assert.equal(model.calls, 1);
  assert.equal(result.status, 'completed');
});

test('Production runtime bootstrap blocks model execution when PRODUCTION_START requirement is missing', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const runtime = createProductionRuntimeBootstrap({
    pool: poolReturning({ clearance: clearanceRow, payment: paymentStateRow }), integrations,
  });
  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  await assert.rejects(() => handler.execute(productionTask({
    financeClearanceId: clearanceRow.clearance_id,
    commercialRecordReference: clearanceRow.commercial_record_reference,
  })), /PRODUCTION_START payment requirement was found/);
  assert.equal(model.calls, 0);
});

test('Production runtime bootstrap blocks model execution when cleared amount is below PRODUCTION_START requirement', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const runtime = createProductionRuntimeBootstrap({
    pool: poolReturning({ ...validOptions(), requirement: { ...requirementRow, required_amount_minor: '15000' } }), integrations,
  });
  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  await assert.rejects(() => handler.execute(productionTask({
    financeClearanceId: clearanceRow.clearance_id,
    commercialRecordReference: clearanceRow.commercial_record_reference,
  })), /amount does not satisfy/);
  assert.equal(model.calls, 0);
});

test('Production runtime bootstrap blocks model execution when persisted Finance clearance is missing', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const runtime = createProductionRuntimeBootstrap({
    pool: poolReturning({ payment: paymentStateRow, requirement: requirementRow }), integrations,
  });
  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  await assert.rejects(() => handler.execute(productionTask({
    financeClearanceId: 'clearance:missing', commercialRecordReference: 'commercial:bootstrap:1',
  })), /not found/);
  assert.equal(model.calls, 0);
});

test('Production runtime bootstrap blocks model execution when current payment authority was revoked', async () => {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const runtime = createProductionRuntimeBootstrap({
    pool: poolReturning({
      clearance: clearanceRow,
      requirement: requirementRow,
      payment: { ...paymentStateRow, payment_status: 'REFUNDED', authority_state: 'BLOCKED', latest_event_type: 'payment_refunded' },
    }),
    integrations,
  });
  const handler = runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  await assert.rejects(() => handler.execute(productionTask({
    financeClearanceId: clearanceRow.clearance_id,
    commercialRecordReference: clearanceRow.commercial_record_reference,
  })), /current payment authority is BLOCKED/);
  assert.equal(model.calls, 0);
});
