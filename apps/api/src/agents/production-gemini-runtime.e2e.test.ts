import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import { createProductionRuntimeExecutor } from './agent-runtime-production-executor.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY, registerProductionModelCapabilities } from './production-model-capabilities.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

const clearance: PersistedFinanceClearanceDecision = {
  clearanceId: 'clearance:synthetic:production-gemini-e2e-1', commercialRecordReference: 'commercial:synthetic:production-gemini-e2e-1',
  providerPaymentReference: 'payment:synthetic:production-gemini-e2e-1', state: 'FINANCE_CLEARED', reason: 'Synthetic provider evidence matched.',
  evidenceReferences: ['payment-provider:synthetic:production-gemini-e2e-1'], amountMinor: 10000, currency: 'ZAR', verifiedAt: '2026-08-18T08:50:00.000Z',
};

function productionTask(): AgentRuntimeTask {
  return {
    taskId: 'task-production-gemini-e2e-1', executionId: 'exec-production-gemini-e2e-1', originAgent: 'operations_agent', destinationAgent: 'production_agent',
    objective: 'Draft a synthetic implementation plan from approved requirements', priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic', financeClearanceId: clearance.clearanceId, commercialRecordReference: clearance.commercialRecordReference },
    knowledgeReferences: ['atlas://production/synthetic-requirements'],
    inputs: { implementationBrief: 'Draft a concise implementation plan for a five-page React website.', technicalContext: 'Synthetic client only. Sales handoff and commercial gate are confirmed. Required pages: Home, About, Services, Projects, Contact. No deployment authorization is supplied.' },
    expectedOutput: 'Technical implementation draft for internal review', dependencies: [], risks: [], confidence: 0.96, approvalRequired: false,
    status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 3, correlationId: 'corr-production-gemini-e2e-1',
    createdAt: '2026-08-18T08:50:00.000Z', updatedAt: '2026-08-18T08:50:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord; readonly events: AgentRuntimeEvent[] = []; readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();
  constructor(task: AgentRuntimeTask) { this.execution = { task, version: 1, persistedAt: '2026-08-18T08:50:00.000Z' }; }
  async getExecution(executionId: string): Promise<AgentRuntimeExecutionRecord | null> { return this.execution.task.executionId === executionId ? this.execution : null; }
  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number): Promise<void> { if (this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId); this.execution = record; }
  async appendEvent(event: AgentRuntimeEvent): Promise<void> { this.events.push(event); }
  async listEvents(executionId: string): Promise<readonly AgentRuntimeEvent[]> { return this.events.filter((event) => event.executionId === executionId); }
  async hasIdempotencyKey(idempotencyKey: string): Promise<boolean> { return this.idempotency.has(idempotencyKey); }
  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord): Promise<void> { this.idempotency.set(record.idempotencyKey, record); }
}

test('production runtime executes Production Agent through governed Gemini draft integration', async () => {
  let providerCalls = 0; let capturedInput: ModelGenerationInput | undefined;
  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini', kind: 'model', provider: 'google-gemini', supportedModes: ['draft'], supportedOperations: ['generate_text'],
    async execute(request) { providerCalls += 1; capturedInput = request.input; return { integrationId: 'model.gemini', operation: request.operation, provider: 'google-gemini', mode: request.mode, status: 'drafted', output: { text: 'Plan: scaffold the approved five-page React structure, implement shared layout components, add supplied content, then run QA before any deployment step.', model: 'gemini-3.5-flash-lite', finishReason: 'stop', inputTokens: 61, outputTokens: 30 }, evidenceReferences: ['gemini:production-e2e:synthetic'], retryable: false }; },
  };
  const integrations = new IntegrationRegistry(); integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerProductionModelCapabilities(handlers, integrations, { async get(id) { return id === clearance.clearanceId ? clearance : null; } });
  const task = productionTask(); const store = new MemoryRuntimeStore(task); let eventId = 0; let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers, now: () => `2026-08-18T08:50:0${second++}.000Z`, createEventId: () => `production-gemini-event-${++eventId}` });
  const production = createProductionRuntimeExecutor({ orchestrator, schedulingSource: { async listSchedulingTasks() { return [store.execution.task]; }, async getAgentCapacity(agentId) { return { agentId, state: 'available', activeTasks: 0, maxConcurrentTasks: 2 }; } } });
  const outcome = await production.execute({ executionId: task.executionId, capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY });
  assert.equal(providerCalls, 1); assert.equal(outcome.replayed, false); assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed'); assert.equal(outcome.record.result?.agentId, 'production_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'model.gemini'); assert.equal(outcome.record.result?.output.provider, 'google-gemini');
  assert.equal(outcome.record.result?.output.mode, 'draft'); assert.equal(outcome.record.result?.output.integrationStatus, 'drafted');
  assert.equal(outcome.record.result?.output.model, 'gemini-3.5-flash-lite'); assert.deepEqual(outcome.record.result?.knowledgeReferences, ['atlas://production/synthetic-requirements']);
  assert.equal(capturedInput?.prompt, 'Draft a concise implementation plan for a five-page React website.'); assert.match(capturedInput?.context ?? '', /Sales handoff and commercial gate are confirmed/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not deploy, publish, merge, push/); assert.match(capturedInput?.systemInstruction ?? '', /Do not claim QA passed/);
  assert.match(capturedInput?.systemInstruction ?? '', /Respect the Production start gate/); assert.match(capturedInput?.systemInstruction ?? '', /Do not invent client facts/);
  assert.equal(store.events.length, 2); assert.equal(store.events[0]?.fromStatus, 'ready'); assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress'); assert.equal(store.events[1]?.toStatus, 'completed'); assert.equal(store.idempotency.size, 2);
  const replay = await production.execute({ executionId: task.executionId, capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY });
  assert.equal(replay.replayed, true); assert.equal(providerCalls, 1); assert.equal(store.events.length, 2);
});
