import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createFinanceReportingControlPlaneRequestHandler } from './finance-reporting-control-plane-request-handler.js';

const token = 'finance-reporting-control-token-1234567890';
const controlCenterUrl = 'http://localhost:5173';

async function withServer(run: (baseUrl: string, state: { expenses: unknown[]; subscriptions: unknown[] }) => Promise<void>) {
  const state = { expenses: [] as unknown[], subscriptions: [] as unknown[] };
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createFinanceReportingControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken: token },
    expenses: {
      async save(record) {
        state.expenses.push(record);
        return 'accepted';
      },
    },
    subscriptions: {
      async save(record) {
        state.subscriptions.push(record);
        return 'accepted';
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, state);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const expense = {
  category: 'SOFTWARE',
  vendor: 'Pilot Vendor',
  description: 'Pilot software expense',
  amountMinor: 25000,
  currency: 'ZAR',
  billingType: 'RECURRING',
  billingPeriod: 'MONTHLY',
  expenseDate: '2026-08-25',
  status: 'PLANNED',
  evidenceReference: 'human://finance/expense/1',
};

const subscription = {
  clientId: '11111111-1111-1111-1111-111111111111',
  service: 'Website maintenance',
  billingFrequency: 'MONTHLY',
  amountMinor: 150000,
  currency: 'ZAR',
  startDate: '2026-08-25',
  nextBillingDate: '2026-09-25',
  status: 'ACTIVE',
  autoRenew: true,
  invoicePolicy: 'Monthly invoice before service period.',
  commercialReference: 'commercial:approved:1',
  evidenceReference: 'human://finance/subscription/1',
};

async function post(baseUrl: string, path: string, body: Record<string, unknown>, authenticated = true) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      origin: controlCenterUrl,
    },
    body: JSON.stringify(body),
  });
}

test('authenticated expense write stamps Human Executive provenance server-side', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await post(baseUrl, '/api/v1/control/finance/reporting/expense', expense);
    assert.equal(response.status, 200);
    assert.equal(state.expenses.length, 1);
    const saved = state.expenses[0] as { approvedBy: string; expenseId: string; evidenceReferences: string[] };
    assert.equal(saved.approvedBy, 'human_executive');
    assert.match(saved.expenseId, /^expense:control:/);
    assert.deepEqual(saved.evidenceReferences, ['human://finance/expense/1']);
  });
});

test('authenticated recurring-plan write stamps Human Executive provenance server-side', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await post(baseUrl, '/api/v1/control/finance/reporting/subscription', subscription);
    assert.equal(response.status, 200);
    assert.equal(state.subscriptions.length, 1);
    const saved = state.subscriptions[0] as { approvedBy: string; subscriptionId: string };
    assert.equal(saved.approvedBy, 'human_executive');
    assert.match(saved.subscriptionId, /^subscription:control:/);
  });
});

test('unauthenticated callers cannot create Finance reporting records', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await post(baseUrl, '/api/v1/control/finance/reporting/expense', expense, false);
    assert.equal(response.status, 401);
    assert.equal(state.expenses.length, 0);
  });
});

test('caller cannot spoof approval authority', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await post(baseUrl, '/api/v1/control/finance/reporting/expense', {
      ...expense,
      approvedBy: 'finance_agent',
    });
    assert.equal(response.status, 400);
    assert.equal(state.expenses.length, 0);
  });
});

test('non-reporting routes fall through unchanged', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    assert.equal(response.status, 418);
  });
});
