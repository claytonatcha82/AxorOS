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
  readonly integrationId = 'model.gemini'; readonly kind = 'model' as const; readonly provider = 'bootstrap-test-model';
  readonly supportedModes = ['draft'] as const; readonly supportedOperations = ['generate_text'] as const; calls = 0;
  async execute(request: IntegrationRequest<ModelGenerationInput>): Promise<IntegrationResponse<ModelGenerationOutput>> {
    this.calls += 1;
    return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'drafted', output: { text: 'governed implementation draft', model: 'bootstrap-test-model', finishReason: 'stop' }, evidenceReferences: ['model:bootstrap-test:1'], retryable: false };
  }
}

const clearanceRow = { clearance_id: 'clearance:bootstrap:1', commercial_record_reference: 'commercial:bootstrap:1', provider_payment_reference: 'pay:bootstrap:1', state: 'FINANCE_CLEARED', reason: 'Provider evidence matched.', evidence_references: ['payment-provider:bootstrap:event:1'], amount_minor: '10000', currency: 'ZAR', verified_at: new Date('2026-08-18T17:00:00.000Z') };
const paymentStateRow = { provider: 'bootstrap', provider_payment_reference: 'pay:bootstrap:1', commercial_record_reference: 'commercial:bootstrap:1', payment_status: 'CONFIRMED', authority_state: 'AUTHORIZED', reason: 'Verified provider payment confirmation supports Finance authorization.', latest_event_type: 'payment_paid', latest_provider_event_reference: 'event:1', latest_evidence_reference: 'payment-provider:bootstrap:event:1', latest_occurred_at: new Date('2026-08-18T17:00:00.000Z'), amount_minor: '10000', currency: 'ZAR' };
const requirementRow = { commercial_record_reference: 'commercial:bootstrap:1', gate: 'PRODUCTION_START', requirement_reference: 'deposit:bootstrap:1', requirement_type: 'DEPOSIT', required_amount_minor: '10000', currency: 'ZAR', status: 'ACTIVE' };
const satisfactionRow = { requirement_reference: 'deposit:bootstrap:1', clearance_id: 'clearance:bootstrap:1', commercial_record_reference: 'commercial:bootstrap:1', gate: 'PRODUCTION_START', satisfied_at: new Date('2026-08-18T17:00:00.000Z') };
const readinessRow = { readiness_id: 'operations-readiness:bootstrap:1', commercial_record_reference: 'commercial:bootstrap:1', state: 'OPERATIONS_READY', contract_signed: true, onboarding_complete: true, assets_available: true, planning_complete: true, evidence_references: ['operations:bootstrap:1'], approved_by: 'operations_agent', approved_at: new Date('2026-08-18T17:00:00.000Z') };
const validContext = { financeClearanceId: clearanceRow.clearance_id, operationsReadinessId: readinessRow.readiness_id, commercialRecordReference: clearanceRow.commercial_record_reference };

type RuntimeFixtureOptions = {
  clearance?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  requirement?: Record<string, unknown>;
  satisfaction?: Record<string, unknown>;
  readiness?: Record<string, unknown>;
};

function productionTask(context: AgentRuntimeTask['context']): AgentRuntimeTask {
  const now = '2026-08-18T17:00:00.000Z';
  return { taskId: 'task-production-bootstrap', executionId: 'exec-production-bootstrap', originAgent: 'operations_agent', destinationAgent: 'production_agent', objective: 'Draft governed implementation', priority: 'normal', context, knowledgeReferences: [], inputs: { implementationBrief: 'Create the governed implementation draft.' }, expectedOutput: 'Technical implementation draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1, correlationId: 'corr-production-bootstrap', createdAt: now, updatedAt: now };
}

function poolReturning(options: RuntimeFixtureOptions): Pick<Pool, 'query'> {
  return { query: (async (sql: string) => {
    const row = sql.includes('finance.clearance_decisions') ? options.clearance
      : sql.includes('finance.commercial_payment_satisfactions') ? options.satisfaction
        : sql.includes('finance.commercial_payment_requirements') ? options.requirement
          : sql.includes('finance.payment_current_state') ? options.payment
            : sql.includes('operations.production_readiness_decisions') ? options.readiness : undefined;
    return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
  }) as unknown as Pool['query'] };
}

const validOptions = (): RuntimeFixtureOptions => ({ clearance: clearanceRow, payment: paymentStateRow, requirement: requirementRow, satisfaction: satisfactionRow, readiness: readinessRow });

function setup(options: RuntimeFixtureOptions = validOptions()) { const model = new CountingModelIntegration(); const integrations = new IntegrationRegistry(); integrations.register(model); const runtime = createProductionRuntimeBootstrap({ pool: poolReturning(options), integrations }); return { model, handler: runtime.handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY) }; }

test('Production runtime requires PRODUCTION_START Finance satisfaction plus Operations readiness', async () => {
  const { model, handler } = setup(); const result = await handler.execute(productionTask(validContext)); assert.equal(model.calls, 1); assert.equal(result.status, 'completed');
});

test('Production runtime blocks when PRODUCTION_START satisfaction is missing', async () => {
  const { model, handler } = setup({ clearance: clearanceRow, payment: paymentStateRow, requirement: requirementRow, readiness: readinessRow });
  await assert.rejects(() => handler.execute(productionTask(validContext)), /has not been satisfied/); assert.equal(model.calls, 0);
});

test('Production runtime blocks when satisfaction points to another clearance', async () => {
  const { model, handler } = setup({ ...validOptions(), satisfaction: { ...satisfactionRow, clearance_id: 'clearance:other' } });
  await assert.rejects(() => handler.execute(productionTask(validContext)), /different Finance clearance/); assert.equal(model.calls, 0);
});

test('Production runtime blocks when current payment authority was revoked', async () => {
  const { model, handler } = setup({ ...validOptions(), payment: { ...paymentStateRow, payment_status: 'REFUNDED', authority_state: 'BLOCKED', latest_event_type: 'payment_refunded' } });
  await assert.rejects(() => handler.execute(productionTask(validContext)), /current payment authority is BLOCKED/); assert.equal(model.calls, 0);
});

test('Production runtime blocks Finance-only authority without Operations readiness context', async () => {
  const { model, handler } = setup();
  await assert.rejects(() => handler.execute(productionTask({ financeClearanceId: clearanceRow.clearance_id, commercialRecordReference: clearanceRow.commercial_record_reference })), /operationsReadinessId/); assert.equal(model.calls, 0);
});

test('Production runtime blocks missing persisted Operations readiness', async () => {
  const { model, handler } = setup({ clearance: clearanceRow, payment: paymentStateRow, requirement: requirementRow, satisfaction: satisfactionRow });
  await assert.rejects(() => handler.execute(productionTask(validContext)), /Operations readiness record was not found/); assert.equal(model.calls, 0);
});
