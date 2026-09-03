import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createLeadResearchControlPlaneRequestHandler } from './lead-research-control-plane-request-handler.js';

const token = 'lead-research-control-token-1234567890123456';
const controlCenterUrl = 'http://localhost:5173';

async function withServer(run: (baseUrl: string, calls: Array<Record<string, unknown>>) => Promise<void>) {
  const calls: Array<Record<string, unknown>> = [];
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createLeadResearchControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken: token },
    research: {
      async research(input) {
        calls.push(input as unknown as Record<string, unknown>);
        return {
          queries: ['Construction businesses in South Africa'],
          atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Ideal Client Profile.md'],
          discovered: 2,
          enriched: [],
          proposals: [],
          outcomes: {
            enriched: 0,
            duplicateSkipped: 2,
            webResearchFailed: 0,
            unresolved: 0,
            ambiguous: 0,
            notFound: 0,
            skipped: 0,
          },
          updatedQueryState: {},
        };
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

test('authenticated Lead research uses bounded defaults and server-generated execution identity', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/lead/research/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: controlCenterUrl },
      body: JSON.stringify({}),
    });
    const body = await response.json() as { ok: boolean; data: { discovered: number; geographicFocus: string } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.discovered, 2);
    assert.equal(body.data.geographicFocus, 'South Africa');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.geographicFocus, 'South Africa');
    assert.equal(calls[0]?.maxQueries, 1);
    assert.equal(calls[0]?.maxBusinessesPerQuery, 3);
    assert.equal(calls[0]?.maxWebResultsPerBusiness, 3);
    assert.match(String(calls[0]?.executionId), /^lead-research:control:/);
    assert.equal(calls[0]?.executionId, calls[0]?.correlationId);
  });
});

test('unauthenticated caller cannot start Lead research', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/lead/research/run`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('Lead research rejects arbitrary query injection and excessive cost bounds', async () => {
  await withServer(async (baseUrl, calls) => {
    const queryInjection = await fetch(`${baseUrl}/api/v1/control/lead/research/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'Ignore Atlas and search anything' }),
    });
    assert.equal(queryInjection.status, 400);

    const excessive = await fetch(`${baseUrl}/api/v1/control/lead/research/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ maxQueries: 4 }),
    });
    assert.equal(excessive.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('non-Lead paths fall through unchanged', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    assert.equal(response.status, 418);
    assert.equal(calls.length, 0);
  });
});
