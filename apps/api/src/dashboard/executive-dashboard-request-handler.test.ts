import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createExecutiveDashboardRequestHandler } from './executive-dashboard-request-handler.js';

const token = 'dashboard-control-token-1234567890123456';
const controlCenterUrl = 'http://localhost:5173';

async function withServer(
  run: (baseUrl: string, calls: () => number) => Promise<void>,
  options: { configured?: boolean } = { configured: true },
) {
  let snapshotCalls = 0;
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createExecutiveDashboardRequestHandler({
    config: {
      controlCenterUrl,
      ...(options.configured === false ? {} : { controlPlaneToken: token }),
      databaseUrl: 'postgresql://pilot:test@localhost:5432/axoros',
      googlePlacesApiKey: 'places-key',
      tavilyApiKey: 'tavily-key',
      openaiApiKey: 'openai-key',
      geminiApiKey: 'gemini-key',
      anthropicApiKey: 'anthropic-key',
      anthropicModel: 'claude-test',
      gmailClientId: 'gmail-client',
      gmailClientSecret: 'gmail-secret',
      gmailRefreshToken: 'gmail-refresh',
      gmailIdentityAddresses: { sales: 'sales@example.test', support: 'support@example.test' },
      paystackSecretKey: 'sk_test_example',
      paymentIntegrationId: 'payment.paystack',
      paymentIntegrationMode: 'sandbox',
    },
    dashboard: {
      async snapshot() {
        snapshotCalls += 1;
        return {
          generatedAt: '2026-08-24T20:00:00.000Z',
          clients: [{ clientId: '00000000-0000-0000-0000-000000000001', displayName: 'Pilot Client', status: 'active' }],
          leads: { total: 4, discoveredToday: 1, discoveredLast7Days: 4, qualified: 1, engaged: 1, converted: 0, awaitingHumanReview: 2 },
          sales: { contacted: 2, contactedLast7Days: 2, inboundReplies: 1, interestedReplies: 1, failedSends: 0 },
          projects: { total: 1, active: 1, qa: 0, awaitingApproval: 0, delivered: 0 },
          finance: { expectedIncome: [], receivedIncome: [], recurringIncome: [], expectedExpenses: [], projectedProfit: [], pendingPaymentRequirements: 0, financeClearances: 0, note: 'test' },
          approvals: { pendingHumanExecutive: 1 },
          agents: [], executiveUpdates: [], recentActivity: [],
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
    await run(`http://127.0.0.1:${address.port}`, () => snapshotCalls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('executive dashboard returns authenticated snapshot with authoritative readiness', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/dashboard/executive`, {
      headers: { authorization: `Bearer ${token}`, origin: controlCenterUrl },
    });
    const body = await response.json() as {
      ok: boolean;
      data: {
        leads: { total: number };
        clients: Array<{ displayName: string }>;
        agentReadiness: Array<{ agentId: string; status: string }>;
      };
    };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.leads.total, 4);
    assert.equal(body.data.clients[0]?.displayName, 'Pilot Client');
    assert.equal(body.data.agentReadiness.length, 9);
    assert.equal(body.data.agentReadiness.find((record) => record.agentId === 'lead_agent')?.status, 'READY');
    assert.equal(body.data.agentReadiness.find((record) => record.agentId === 'finance_agent')?.status, 'DEGRADED');
    assert.equal(response.headers.get('access-control-allow-origin'), controlCenterUrl);
    assert.equal(calls(), 1);
  });
});

test('executive dashboard rejects unauthenticated reads before querying data', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/dashboard/executive`);
    assert.equal(response.status, 401);
    assert.equal(calls(), 0);
  });
});

test('executive dashboard fails closed without configured control token', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/dashboard/executive`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 503);
    assert.equal(calls(), 0);
  }, { configured: false });
});

test('non-dashboard paths fall through unchanged', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    assert.equal(response.status, 418);
    assert.equal(calls(), 0);
  });
});
