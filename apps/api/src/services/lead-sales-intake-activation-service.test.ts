import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { RuntimeMutation } from '../agents/agent-runtime-store.js';
import { createLeadSalesIntakeActivationService } from './lead-sales-intake-activation-service.js';

function record(): AgentRuntimeExecutionRecord {
  const createdAt = '2026-08-20T17:40:00.000Z';
  return {
    task: {
      taskId: 'sales-intake-task:eligibility-1', executionId: 'sales-intake:eligibility-1', originAgent: 'lead_agent', destinationAgent: 'sales_agent',
      objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.', priority: 'normal',
      context: { leadId: 'lead-1' }, knowledgeReferences: ['Volume 1 - Agency/06 Sales System/Sales System.md'],
      inputs: { salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
      expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.', dependencies: [], risks: [], confidence: 1,
      approvalRequired: false, status: 'queued', nextAction: 'configure_governed_sales_intake_processing', attempt: 1, maxAttempts: 1,
      correlationId: 'corr-1', createdAt, updatedAt: createdAt,
    },
    version: 1,
    persistedAt: createdAt,
  };
}

class Store {
  current = record();
  mutation: RuntimeMutation | null = null;
  ids = new Set<string>();
  async getExecution(id: string) { return this.current.task.executionId === id ? this.current : null; }
  async hasIdempotencyKey(key: string) { return this.ids.has(key); }
  async commitRuntimeMutation(mutation: RuntimeMutation) { this.mutation = mutation; this.current = mutation.record; this.ids.add(mutation.idempotencyRecord.idempotencyKey); }
}

test('activates queued Sales intake to ready without authorising outreach', async () => {
  const store = new Store();
  const service = createLeadSalesIntakeActivationService(store, () => 'event-1', () => '2026-08-20T17:41:00.000Z');
  const activated = await service.activate('sales-intake:eligibility-1');
  assert.equal(activated.task.status, 'ready');
  assert.equal(activated.task.nextAction, 'execute_internal_sales_intake');
  assert.equal(activated.task.inputs.salesDispatchAuthorised, false);
  assert.equal(activated.task.inputs.outreachAuthorised, false);
  assert.equal(store.mutation?.event.fromStatus, 'queued');
  assert.equal(store.mutation?.event.toStatus, 'ready');
  assert.equal(store.mutation?.expectedVersion, 1);
});

test('fails closed if outreach authority was introduced', async () => {
  const store = new Store();
  store.current = { ...store.current, task: { ...store.current.task, inputs: { ...store.current.task.inputs, outreachAuthorised: true } } };
  const service = createLeadSalesIntakeActivationService(store);
  await assert.rejects(() => service.activate(store.current.task.executionId), /must not authorise Sales dispatch or outreach/i);
});
