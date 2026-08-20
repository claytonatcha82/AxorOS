import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';

const controlPlaneToken = 'control-plane-test-token-1234567890abcdef';
const controlCenterUrl = 'http://localhost:5173';

function reviewOutcome(status: 'review' | 'ready', approvalRequired: boolean): RuntimeExecutionOutcome {
  const now = '2026-08-20T17:00:00.000Z';
  return {
    replayed: false,
    record: {
      task: {
        taskId: 'lead-qualification-review-task:disposition-1',
        executionId: 'lead-qualification-review:disposition-1',
        originAgent: 'lead_agent',
        destinationAgent: 'lead_agent',
        objective: 'Obtain human review of the Atlas-backed lead qualification disposition.',
        priority: 'normal',
        context: {},
        knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
        inputs: {},
        expectedOutput: 'A governed human approval decision for the recorded lead qualification disposition.',
        dependencies: [],
        risks: [],
        confidence: 1,
        approvalRequired,
        ...(approvalRequired ? { approvalOwner: 'human_executive' as const } : {}),
        status,
        nextAction: approvalRequired ? 'obtain_required_approval' : 'execute_destination_capability',
        attempt: 1,
        maxAttempts: 1,
        correlationId: 'corr-1',
        createdAt: now,
        updatedAt: now,
      },
      version: 2,
      persistedAt: now,
    },
  };
}

async function withServer(run: (baseUrl: string, calls: { request: number; resolve: number }) => Promise<void>): Promise<void> {
  const calls = { request: 0, resolve: 0 };
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418);
    response.end();
  };
  const handler = createControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken },
    productionCommand: {
      async execute() {
        throw new Error('Production command should not execute in Lead review tests.');
      },
    },
    leadQualificationReviewCommand: {
      async requestReview(executionId) {
        calls.request += 1;
        assert.equal(executionId, 'lead-qualification-review:disposition-1');
        return reviewOutcome('review', true);
      },
      async resolveReview(executionId, decision, reason) {
        calls.resolve += 1;
        assert.equal(executionId, 'lead-qualification-review:disposition-1');
        assert.equal(decision, 'approved');
        assert.equal(reason, 'Founder approved controlled continuation.');
        return reviewOutcome('ready', false);
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('authenticated control plane can request governed Lead qualification review', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/lead-qualification-review/request`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'lead-qualification-review:disposition-1' }),
    });
    const body = await response.json() as { ok: boolean; data: { status: string; approvalRequired: boolean; approvalOwner: string; nextAction: string } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'review');
    assert.equal(body.data.approvalRequired, true);
    assert.equal(body.data.approvalOwner, 'human_executive');
    assert.equal(body.data.nextAction, 'obtain_required_approval');
    assert.equal(calls.request, 1);
    assert.equal(calls.resolve, 0);
  });
});

test('authenticated control plane records only an explicit human review decision', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/lead-qualification-review/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'lead-qualification-review:disposition-1',
        decision: 'approved',
        reason: 'Founder approved controlled continuation.',
      }),
    });
    const body = await response.json() as { ok: boolean; data: { status: string; approvalRequired: boolean; nextAction: string } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.approvalRequired, false);
    assert.equal(body.data.nextAction, 'execute_destination_capability');
    assert.equal(calls.request, 0);
    assert.equal(calls.resolve, 1);
  });
});

test('Lead qualification review resolution rejects caller-supplied authority fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/lead-qualification-review/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'lead-qualification-review:disposition-1',
        decision: 'approved',
        actor: 'lead_agent',
      }),
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_lead_qualification_review_resolution');
    assert.equal(calls.request, 0);
    assert.equal(calls.resolve, 0);
  });
});
