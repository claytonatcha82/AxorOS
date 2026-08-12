import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';

const task = {} as AgentRuntimeTask;

test('runtime handler registry resolves exact agent capability handlers', async () => {
  const registry = new AgentRuntimeHandlerRegistry();
  registry.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute() {
      return {
        executionId: 'exec-1',
        taskId: 'task-1',
        agentId: 'lead_agent',
        status: 'completed',
        output: {},
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 1,
      };
    },
  });

  const handler = registry.require('lead_agent', 'qualify_lead');
  assert.equal((await handler.execute(task)).agentId, 'lead_agent');
});

test('runtime handler registry rejects duplicate registrations', () => {
  const registry = new AgentRuntimeHandlerRegistry();
  const handler = {
    agentId: 'lead_agent' as const,
    capabilityId: 'qualify_lead',
    async execute() {
      return {
        executionId: 'exec-1', taskId: 'task-1', agentId: 'lead_agent' as const, status: 'completed' as const,
        output: {}, evidenceReferences: [], knowledgeReferences: [], confidence: 1,
      };
    },
  };
  registry.register(handler);
  assert.throws(() => registry.register(handler), /already registered/);
});

test('runtime handler registry refuses missing handlers', () => {
  const registry = new AgentRuntimeHandlerRegistry();
  assert.throws(() => registry.require('sales_agent', 'close_sale'), /no runtime handler registered/);
});
