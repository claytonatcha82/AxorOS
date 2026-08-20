import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord } from './agents/agent-runtime-state.js';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { createSalesIntakeControlPlaneRequestHandler } from './sales-intake-control-plane-request-handler.js';

const controlPlaneToken = 'control-plane-test-token-1234567890abcdef';
const controlCenterUrl = 'http://localhost:5173';
const now = '2026-08-20T17:00:00.000Z';

function taskRecord(status: 'queued' | 'ready' | 'completed'): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'sales-intake-task:workflow-1',
      executionId: 'sales-intake:workflow-1',
      originAgent: 'lead_agent',
      destinationAgent: 'sales_agent',
      objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.',
      priority: 'normal',
      context: { leadId: 'lead-1', eligibilityRecordId: 'workflow-1' },
      knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
      inputs: {
        salesIntakeOnly: true,
        salesDispatchAuthorised: false,
        outreachAuthorised: false,
      },
      expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
      dependencies: [],
      risks: [],
      confidence: 1,
      approvalRequired: false,
      status,
      nextAction: status === 'queued' ? 'configure_governed_sales_intake_processing' : status === 'ready' ? 'execute_internal_sales_intake' : 'define_governed_sales_opportunity_assessment',
      attempt: 1,
      maxAttempts: 1,
      correlationId: 'corr-1',
      createdAt: now,
      updatedAt: now,
    },
    ...(status === 'completed' ? {
      result: {
        executionId: 'sales-intake:workflow-1',
        taskId: 'sales-intake-task:workflow-1',
        agentId: 'sales_agent' as const,
        status: 'completed' as const,
        output: {
          intakeAccepted: true,
          salesDispatchAuthorised: false,
          outreachAuthorised: false,
        },
        evidenceReferences: [],
        knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
        confidence: 1,
      },
    } : {}),
    version: 2,
    persistedAt: now,
  };
}

async function withServer(run: (baseUrl: string, calls: { activate: number; process: number }) => Promise<void>): Promise<void> {
  const calls = { activate: 0, process: 0 };
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418);
    response.end();
  };
  const handler = createSalesIntakeControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken },
    salesIntakeCommand: {
      async activateIntake(executionId) {
        calls.activate += 1;
        assert.equal(executionId, 'sales-intake:workflow-1');
        return taskRecord('ready');
      },
      async processIntake(executionId): Promise<RuntimeExecutionOutcome> {
        calls.process += 1;
        assert.equal(executionId, 'sales-intake:workflow-1');
        return { record: taskRecord('completed'), replayed: false };
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

test('authenticated control plane activates queued Sales intake without authorising outreach', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/activate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1' }),
    });
    const body = await response.json() as { ok: boolean; data: { status: string; salesDispatchAuthorised: boolean; outreachAuthorised: boolean } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.salesDispatchAuthorised, false);
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(calls.activate, 1);
    assert.equal(calls.process, 0);
  });
});

test('authenticated control plane processes internal Sales intake without prospect contact authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/process`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1' }),
    });
    const body = await response.json() as { ok: boolean; data: { status: string; resultStatus: string; salesDispatchAuthorised: boolean; outreachAuthorised: boolean } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'completed');
    assert.equal(body.data.resultStatus, 'completed');
    assert.equal(body.data.salesDispatchAuthorised, false);
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 1);
  });
});

test('Sales intake controls reject caller-supplied authority fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/process`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1', outreachAuthorised: true }),
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_intake_command');
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 0);
  });
});
