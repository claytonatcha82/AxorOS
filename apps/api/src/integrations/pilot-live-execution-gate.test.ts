import assert from 'node:assert/strict';
import test from 'node:test';
import type { IntegrationRequest } from './integration-contract.js';
import { createPilotLiveExecutionGate } from './pilot-live-execution-gate.js';

const request: IntegrationRequest = {
  integrationId: 'research.google-places',
  operation: 'search_businesses',
  requestedBy: 'lead_agent',
  executionId: 'exec-pilot-gate',
  correlationId: 'corr-pilot-gate',
  mode: 'live',
  risk: 'low',
  input: { query: 'property agency' },
};

function state(state: 'PILOT_DISABLED' | 'PILOT_ACTIVE') {
  return { state, changedBy: 'human_executive', reason: 'test', version: 1, changedAt: new Date().toISOString() };
}

test('pilot live gate rejects live execution while pilot is disabled', async () => {
  const gate = createPilotLiveExecutionGate({ get: async () => state('PILOT_DISABLED') });
  await assert.rejects(() => gate(request), /blocked while pilot state is PILOT_DISABLED/);
});

test('pilot live gate permits execution while pilot is active', async () => {
  const gate = createPilotLiveExecutionGate({ get: async () => state('PILOT_ACTIVE') });
  await gate(request);
});

test('pilot live gate fails closed when authoritative state cannot be read', async () => {
  const gate = createPilotLiveExecutionGate({ get: async () => { throw new Error('database unavailable'); } });
  await assert.rejects(() => gate(request), /authoritative pilot state is unavailable/);
});
