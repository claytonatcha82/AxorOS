import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './production-model-capabilities.js';
import { createPersistedProductionRuntime } from './production-persisted-runtime.js';

class CountingModelIntegration implements ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  readonly integrationId = 'model.gemini'; readonly kind = 'model' as const; readonly provider = 'persisted-runtime-test-model';
  readonly supportedModes = ['draft'] as const; readonly supportedOperations = ['generate_text'] as const; calls = 0;
  async execute(request: IntegrationRequest<ModelGenerationInput>): Promise<IntegrationResponse<ModelGenerationOutput>> {
    this.calls += 1;
    return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'drafted', output: { text: 'persisted governed draft', model: 'test-model', finishReason: 'stop' }, evidenceReferences: ['model:persisted-runtime-test:1'], retryable: false };
  }
}

function record(): AgentRuntimeExecutionRecord {
  const now = '2026-08-18T17:10:00.000Z';
  return { task: { taskId: 'task-production-persisted', executionId: 'exec-production-persisted', originAgent: 'operations_agent', destinationAgent: 'production_agent', objective: 'Draft governed implementation', priority: 'normal', context: { financeClearanceId: 'clearance:persisted:1', commercialRecordReference: 'commercial:persisted:1' }, knowledgeReferences: [], inputs: { implementationBrief: 'Create the governed implementation draft.' }, expectedOutput: 'Technical implementation draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1, correlationId: 'corr-production-persisted', createdAt: now, updatedAt: now }, version: 1, persistedAt: now };
}

function createPool(initial: AgentRuntimeExecutionRecord, financeCleared: boolean): Pool {
  let current = initial; const idempotency = new Set<string>();
  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('from runtime.agent_executions') && sql.includes('where execution_id = $1')) return { rowCount: 1, rows: [{ task: current.task, result: current.result ?? null, version: current.version, last_event_id: current.lastEventId ?? null, persisted_at: current.persistedAt }] };
    if (sql.includes('from runtime.idempotency_records')) { const key = String(values[0]); return { rowCount: idempotency.has(key) ? 1 : 0, rows: idempotency.has(key) ? [{ '?column?': 1 }] : [] }; }
    if (sql.includes('from finance.clearance_decisions')) return { rowCount: financeCleared ? 1 : 0, rows: financeCleared ? [{ clearance_id: 'clearance:persisted:1', commercial_record_reference: 'commercial:persisted:1', provider_payment_reference: 'pay:persisted:1', state: 'FINANCE_CLEARED', reason: 'Provider evidence matched.', evidence_references: ['payment-provider:sandbox:event:1'], amount_minor: '10000', currency: 'ZAR', verified_at: new Date('2026-08-18T17:10:00.000Z') }] : [] };
    if (sql.includes('from finance.commercial_payment_requirements')) return { rowCount: financeCleared ? 1 : 0, rows: financeCleared ? [{ commercial_record_reference: 'commercial:persisted:1', gate: 'PRODUCTION_START', requirement_reference: 'deposit:persisted:1', requirement_type: 'DEPOSIT', required_amount_minor: '10000', currency: 'ZAR', status: 'ACTIVE' }] : [] };
    if (sql.includes('from finance.commercial_payment_satisfactions')) return { rowCount: financeCleared ? 1 : 0, rows: financeCleared ? [{ requirement_reference: 'deposit:persisted:1', clearance_id: 'clearance:persisted:1', commercial_record_reference: 'commercial:persisted:1', gate: 'PRODUCTION_START', satisfied_at: new Date('2026-08-18T17:10:00.000Z') }] : [] };
    if (sql.includes('from finance.payment_current_state')) return { rowCount: financeCleared ? 1 : 0, rows: financeCleared ? [{ provider: 'sandbox', provider_payment_reference: 'pay:persisted:1', commercial_record_reference: 'commercial:persisted:1', payment_status: 'CONFIRMED', authority_state: 'AUTHORIZED', reason: 'Verified provider payment confirmation supports Finance authorization.', latest_event_type: 'payment_paid', latest_provider_event_reference: 'event:1', latest_evidence_reference: 'payment-provider:sandbox:event:1', latest_occurred_at: new Date('2026-08-18T17:10:00.000Z'), amount_minor: '10000', currency: 'ZAR' }] : [] };
    if (sql.startsWith('update runtime.agent_executions')) { current = { task: JSON.parse(String(values[6])) as AgentRuntimeExecutionRecord['task'], ...(values[7] === null ? {} : { result: JSON.parse(String(values[7])) as NonNullable<AgentRuntimeExecutionRecord['result']> }), version: Number(values[5]), ...(values[8] === null ? {} : { lastEventId: String(values[8]) }), persistedAt: String(values[9]) }; return { rowCount: 1, rows: [{ execution_id: current.task.executionId }] }; }
    if (sql.includes('insert into runtime.idempotency_records')) { idempotency.add(String(values[0])); return { rowCount: 1, rows: [] }; }
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql.includes('insert into runtime.agent_events')) return { rowCount: 1, rows: [] };
    throw new Error(`unexpected test SQL: ${sql}`);
  };
  const client = { query, release() {} };
  return { query, async connect() { return client; } } as unknown as Pool;
}

function integrations(model: CountingModelIntegration): IntegrationRegistry { const registry = new IntegrationRegistry(); registry.register(model); return registry; }

test('persisted Production orchestrator executes only after requirement-specific Finance satisfaction', async () => {
  const model = new CountingModelIntegration(); const runtime = createPersistedProductionRuntime({ pool: createPool(record(), true), integrations: integrations(model) });
  const outcome = await runtime.orchestrator.execute({ executionId: 'exec-production-persisted', capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY });
  assert.equal(model.calls, 1); assert.equal(outcome.record.task.status, 'completed'); assert.equal(outcome.record.result?.status, 'completed');
});

test('persisted Production orchestrator records failure and never calls model when Finance clearance is missing', async () => {
  const model = new CountingModelIntegration(); const runtime = createPersistedProductionRuntime({ pool: createPool(record(), false), integrations: integrations(model) });
  const outcome = await runtime.orchestrator.execute({ executionId: 'exec-production-persisted', capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY });
  assert.equal(model.calls, 0); assert.equal(outcome.record.task.status, 'failed'); assert.match(outcome.record.result?.errorMessage ?? '', /not found/);
});
