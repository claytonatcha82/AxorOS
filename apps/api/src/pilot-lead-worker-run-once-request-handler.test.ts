import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createPilotLeadWorkerRunOnceRequestHandler } from './pilot-lead-worker-run-once-request-handler.js';

const token = 'a'.repeat(40);
const config = { controlCenterUrl: 'https://control.example', controlPlaneToken: token };
const fallback = (_request: unknown, response: any) => { response.writeHead(404); response.end(); };

async function withServer(handler: ReturnType<typeof createPilotLeadWorkerRunOnceRequestHandler>, run: (port: number) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  try { await run(address.port); } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(port: number, body: Record<string, unknown>, authorization?: string) {
  const payload = JSON.stringify(body);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path: '/api/v1/control/pilot/lead-worker/run-once', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(authorization ? { authorization } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject); req.write(payload); req.end();
  });
}

test('requires authenticated Human Executive control-plane request', async () => {
  let calls = 0;
  const handler = createPilotLeadWorkerRunOnceRequestHandler({
    config, fallback,
    worker: { async runOnce() { calls += 1; return null; } },
  });
  await withServer(handler, async (port) => {
    const response = await post(port, { confirmation: 'RUN PILOT LEAD CYCLE' });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });
});

test('fails closed unless exact run-once confirmation is supplied', async () => {
  let calls = 0;
  const handler = createPilotLeadWorkerRunOnceRequestHandler({
    config, fallback,
    worker: { async runOnce() { calls += 1; return null; } },
  });
  await withServer(handler, async (port) => {
    const response = await post(port, { confirmation: 'RUN' }, `Bearer ${token}`);
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test('executes the bounded worker and returns Atlas/review evidence', async () => {
  const output = {
    queries: ['website businesses South Africa'],
    atlasSourcePaths: ['Volume 1/Ideal Client.md'],
    discovered: 1,
    enriched: [{
      leadId: 'lead-1',
      companyName: 'Synthetic Business',
      officialWebsiteUrl: 'https://example.com',
      preliminaryQualification: { suggestedStatus: 'qualified' },
      qualificationDisposition: { recommendedAction: 'human_review' },
      qualificationReviewExecutionId: 'review-1',
    }],
    proposals: [],
    outcomes: { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 },
  } as any;
  const handler = createPilotLeadWorkerRunOnceRequestHandler({
    config, fallback,
    worker: { async runOnce() { return output; } },
  });
  await withServer(handler, async (port) => {
    const response = await post(port, { confirmation: 'RUN PILOT LEAD CYCLE' }, `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.discovered, 1);
    assert.deepEqual(response.body.data.atlasSourcePaths, ['Volume 1/Ideal Client.md']);
    assert.equal(response.body.data.enriched[0].reviewExecutionId, 'review-1');
    assert.deepEqual(response.body.data.candidateOutcomes, { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 });
  });
});

test('returns conflict when pilot is disabled or another cycle owns execution', async () => {
  const handler = createPilotLeadWorkerRunOnceRequestHandler({
    config, fallback,
    worker: { async runOnce() { return null; } },
  });
  await withServer(handler, async (port) => {
    const response = await post(port, { confirmation: 'RUN PILOT LEAD CYCLE' }, `Bearer ${token}`);
    assert.equal(response.status, 409);
  });
});
