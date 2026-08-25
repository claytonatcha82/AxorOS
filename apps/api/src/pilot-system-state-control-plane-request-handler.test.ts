import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createPilotSystemStateControlPlaneRequestHandler } from './pilot-system-state-control-plane-request-handler.js';

const token = 'pilot-control-token-1234567890123456';
const controlCenterUrl = 'http://localhost:5173';
const fullReadyConfig = {
  controlCenterUrl,
  controlPlaneToken: token,
  databaseUrl: 'postgresql://pilot:pilot@localhost:5432/axoros',
  geminiApiKey: 'gemini-test',
  openaiApiKey: 'openai-test',
  anthropicApiKey: 'anthropic-test',
  anthropicModel: 'claude-test',
  productionModelIntegrationId: 'model.anthropic' as const,
  gmailClientId: 'gmail-client',
  gmailClientSecret: 'gmail-secret',
  gmailRefreshToken: 'gmail-refresh',
  gmailIdentityAddresses: { sales: 'sales@example.com', support: 'support@example.com', marketing: 'marketing@example.com' },
  googlePlacesApiKey: 'places-test',
  tavilyApiKey: 'tavily-test',
  paystackSecretKey: 'sk_live_test',
  paymentIntegrationId: 'payment.paystack' as const,
  paymentIntegrationMode: 'live' as const,
};

async function withServer(
  config: Record<string, unknown>,
  run: (baseUrl: string, writes: () => Array<{ state: string; reason: string }>) => Promise<void>,
) {
  const changes: Array<{ state: string; reason: string }> = [];
  const fallback: RequestListener = (_request, response) => { response.writeHead(418); response.end(); };
  const handler = createPilotSystemStateControlPlaneRequestHandler({
    config: config as never,
    store: {
      async get() { return { state: 'PILOT_DISABLED', changedBy: 'system', reason: 'test', version: 1, changedAt: '2026-08-25T00:00:00.000Z' } as const; },
      async set(state, _changedBy, reason) {
        changes.push({ state, reason });
        return { state, changedBy: 'human_executive', reason, version: 2, changedAt: '2026-08-25T00:01:00.000Z' };
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, () => changes); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function post(baseUrl: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/v1/control/pilot/state`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('pilot activation is blocked when authoritative readiness is not fully READY', async () => {
  await withServer({ controlCenterUrl, controlPlaneToken: token, databaseUrl: fullReadyConfig.databaseUrl }, async (baseUrl, writes) => {
    const response = await post(baseUrl, { state: 'PILOT_ACTIVE', reason: 'Begin pilot.', confirmation: 'ACTIVATE PILOT' });
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'pilot_activation_readiness_blocked');
    assert.match(body.error.message, /lead_agent=NOT_CONFIGURED/);
    assert.equal(writes().length, 0);
  });
});

test('pilot activation requires exact Human Executive confirmation even when fully READY', async () => {
  await withServer(fullReadyConfig, async (baseUrl, writes) => {
    const response = await post(baseUrl, { state: 'PILOT_ACTIVE', reason: 'Begin pilot.', confirmation: 'activate pilot' });
    assert.equal(response.status, 409);
    assert.equal(writes().length, 0);
  });
});

test('pilot activation succeeds only when all agents are READY and confirmation is exact', async () => {
  await withServer(fullReadyConfig, async (baseUrl, writes) => {
    const response = await post(baseUrl, { state: 'PILOT_ACTIVE', reason: 'Readiness audit passed.', confirmation: 'ACTIVATE PILOT' });
    assert.equal(response.status, 200);
    assert.deepEqual(writes(), [{ state: 'PILOT_ACTIVE', reason: 'Readiness audit passed.' }]);
  });
});

test('pilot deactivation remains available regardless of readiness', async () => {
  await withServer({ controlCenterUrl, controlPlaneToken: token }, async (baseUrl, writes) => {
    const response = await post(baseUrl, { state: 'PILOT_DISABLED', reason: 'Human Executive emergency stop.' });
    assert.equal(response.status, 200);
    assert.deepEqual(writes(), [{ state: 'PILOT_DISABLED', reason: 'Human Executive emergency stop.' }]);
  });
});
