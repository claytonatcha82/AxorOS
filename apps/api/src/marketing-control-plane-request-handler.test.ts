import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createMarketingControlPlaneRequestHandler } from './marketing-control-plane-request-handler.js';

const token = 'marketing-control-token-1234567890123456';
const controlCenterUrl = 'http://localhost:5173';

function marketingOutcome() {
  const now = new Date().toISOString();
  const executionId = 'marketing:draft:test';
  return {
    record: {
      task: {
        taskId: `task:${executionId}`,
        executionId,
        originAgent: 'human_executive' as const,
        destinationAgent: 'marketing_agent' as const,
        objective: 'Draft Atlas-grounded marketing content for Human Executive review',
        priority: 'normal' as const,
        context: { publicationAuthorized: false },
        knowledgeReferences: ['Volume 1 - Agency/08 - Marketing System/Marketing Strategy.md.md'],
        inputs: { brief: 'Draft educational website strategy content', context: 'Atlas context' },
        expectedOutput: 'One evidence-bounded Marketing draft for Human Executive review',
        dependencies: [],
        risks: [],
        confidence: 1,
        approvalRequired: false,
        status: 'completed' as const,
        nextAction: 'execute_marketing_draft_capability',
        attempt: 1,
        maxAttempts: 1,
        correlationId: executionId,
        createdAt: now,
        updatedAt: now,
      },
      result: {
        executionId,
        taskId: `task:${executionId}`,
        agentId: 'marketing_agent' as const,
        status: 'completed' as const,
        output: { text: 'Educational website strategy draft.' },
        evidenceReferences: [],
        knowledgeReferences: ['Volume 1 - Agency/08 - Marketing System/Marketing Strategy.md.md'],
        confidence: 1,
        completedAt: now,
      },
      version: 2,
      persistedAt: now,
    },
    replayed: false,
  };
}

async function withServer(run: (baseUrl: string, calls: Array<Record<string, unknown>>) => Promise<void>) {
  const calls: Array<Record<string, unknown>> = [];
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createMarketingControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken: token },
    marketing: {
      async draft(input) {
        calls.push(input as unknown as Record<string, unknown>);
        return marketingOutcome();
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

test('authenticated Marketing draft remains draft-only and returns Atlas references', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/marketing/draft`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: controlCenterUrl },
      body: JSON.stringify({ brief: 'Draft educational website strategy content' }),
    });
    const body = await response.json() as {
      ok: boolean;
      data: { executionId: string; publicationAuthorized: boolean; knowledgeReferences: string[] };
    };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.executionId, 'marketing:draft:test');
    assert.equal(body.data.publicationAuthorized, false);
    assert.equal(body.data.knowledgeReferences.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.brief, 'Draft educational website strategy content');
  });
});

test('unauthenticated caller cannot create a Marketing draft', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/marketing/draft`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('Marketing control plane rejects unsupported publication fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/marketing/draft`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ brief: 'Draft content', publish: true }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('non-Marketing paths fall through unchanged', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    assert.equal(response.status, 418);
    assert.equal(calls.length, 0);
  });
});
