import { createServer } from 'node:http';
import pg from 'pg';
import { createExecutiveDashboardRequestHandler } from '../apps/api/dist/dashboard/executive-dashboard-request-handler.js';
import { createExecutiveDashboardService } from '../apps/api/dist/dashboard/executive-dashboard-service.js';

const { Pool } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
}

const connectionString = required('AXOROS_DATABASE_URL');
const controlPlaneToken = required('AXOROS_CONTROL_PLANE_TOKEN');
const controlCenterUrl = process.env.AXOROS_CONTROL_CENTER_URL?.trim() || 'http://localhost:5173';
const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: 'axoros-executive-dashboard-verify',
});
const dashboard = createExecutiveDashboardService(pool);
const fallback = (_request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false, error: { code: 'not_found' } }));
};
const handler = createExecutiveDashboardRequestHandler({
  config: { controlCenterUrl, controlPlaneToken },
  dashboard,
  fallback,
});
const server = createServer(handler);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/v1/control/dashboard/executive`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: controlCenterUrl,
    },
  });
  const payload = await response.json();
  return { response, payload };
}

function moneyMap(rows) {
  return new Map(rows.map((row) => [String(row.currency), Number(row.amount_minor ?? 0)]));
}

function assertMoneyMatches(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be an array.`);
  const actualMap = new Map(actual.map((item) => [String(item.currency), Number(item.amountMinor ?? 0)]));
  assert(actualMap.size === expected.size, `${label} currency count does not match authoritative PostgreSQL state.`);
  for (const [currency, amountMinor] of expected) {
    assert(actualMap.get(currency) === amountMinor, `${label} for ${currency} does not match authoritative PostgreSQL state.`);
    const item = actual.find((candidate) => candidate.currency === currency);
    assert(item?.available === true, `${label} for ${currency} must be marked available when authoritative data exists.`);
  }
}

try {
  await pool.query('select 1');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Verification HTTP server did not expose a TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthenticated = await get(baseUrl);
  assert(unauthenticated.response.status === 401, `Expected unauthenticated dashboard request to return 401, got ${unauthenticated.response.status}.`);

  const authenticated = await get(baseUrl, controlPlaneToken);
  assert(authenticated.response.status === 200, `Expected authenticated dashboard request to return 200, got ${authenticated.response.status}: ${JSON.stringify(authenticated.payload)}`);
  assert(authenticated.payload?.ok === true, 'Authenticated dashboard response must be ok=true.');

  const data = authenticated.payload.data;
  assert(data && typeof data === 'object', 'Dashboard response data is missing.');
  assert(Array.isArray(data.agents) && data.agents.length === 9, 'Dashboard must expose exactly nine core agent status records.');
  assert(new Set(data.agents.map((agent) => agent.agentId)).size === 9, 'Dashboard agent records must be unique by agentId.');
  assert(Array.isArray(data.finance?.expectedIncome), 'Dashboard expectedIncome must be an array.');
  assert(Array.isArray(data.finance?.receivedIncome), 'Dashboard receivedIncome must be an array.');
  assert(Array.isArray(data.finance?.recurringIncome), 'Dashboard recurringIncome must be an array.');
  assert(Array.isArray(data.finance?.expectedExpenses), 'Dashboard expectedExpenses must be an array.');
  assert(data.finance?.projectedProfit?.[0]?.available === false, 'Projected profit must remain explicitly unavailable until an authoritative period-based profitability basis exists.');

  const [leadCount, projectCount, pendingApprovalCount, recurringIncomeRows, expectedExpenseRows] = await Promise.all([
    pool.query('select count(*)::int as total from operational.leads'),
    pool.query('select count(*)::int as total from operational.projects'),
    pool.query(`select count(*)::int as pending from runtime.agent_executions
      where status = 'review' and task->>'approvalRequired' = 'true' and task->>'approvalOwner' = 'human_executive'`),
    pool.query(`select currency,
      round(sum(case billing_frequency
        when 'MONTHLY' then amount_minor::numeric
        when 'QUARTERLY' then amount_minor::numeric / 3
        when 'ANNUAL' then amount_minor::numeric / 12
      end))::bigint as amount_minor
      from finance.subscriptions
      where status = 'ACTIVE'
      group by currency order by currency`),
    pool.query(`select currency,
      round(sum(case
        when billing_type = 'RECURRING' then
          case billing_period
            when 'MONTHLY' then amount_minor::numeric
            when 'QUARTERLY' then amount_minor::numeric / 3
            when 'ANNUAL' then amount_minor::numeric / 12
          end
        when billing_type = 'ONE_TIME'
          and status = 'PLANNED'
          and expense_date >= date_trunc('month', current_date)::date
          and expense_date < (date_trunc('month', current_date) + interval '1 month')::date
          then amount_minor::numeric
        else 0
      end))::bigint as amount_minor
      from finance.expenses
      where status <> 'CANCELLED'
      group by currency
      having sum(case
        when billing_type = 'RECURRING' then amount_minor::numeric
        when billing_type = 'ONE_TIME'
          and status = 'PLANNED'
          and expense_date >= date_trunc('month', current_date)::date
          and expense_date < (date_trunc('month', current_date) + interval '1 month')::date
          then amount_minor::numeric
        else 0 end) > 0
      order by currency`),
  ]);

  assert(data.leads.total === Number(leadCount.rows[0]?.total ?? 0), 'Dashboard lead total does not match authoritative PostgreSQL state.');
  assert(data.projects.total === Number(projectCount.rows[0]?.total ?? 0), 'Dashboard project total does not match authoritative PostgreSQL state.');
  assert(data.approvals.pendingHumanExecutive === Number(pendingApprovalCount.rows[0]?.pending ?? 0), 'Dashboard pending approval total does not match authoritative PostgreSQL state.');
  assertMoneyMatches(data.finance.recurringIncome, moneyMap(recurringIncomeRows.rows), 'Dashboard recurring income');
  assertMoneyMatches(data.finance.expectedExpenses, moneyMap(expectedExpenseRows.rows), 'Dashboard expected expenses');

  console.log('PASS  Executive Dashboard authenticated live-data verification.');
  console.log(`Generated at: ${data.generatedAt}`);
  console.log(`Leads: ${data.leads.total} total; ${data.leads.awaitingHumanReview} awaiting Human Executive review.`);
  console.log(`Sales: ${data.sales.contacted} contacted; ${data.sales.inboundReplies} inbound replies; ${data.sales.interestedReplies} interested/information/commercial/meeting replies.`);
  console.log(`Projects: ${data.projects.total} total; ${data.projects.active} active; ${data.projects.delivered} delivered.`);
  console.log(`Pending Human Executive approvals: ${data.approvals.pendingHumanExecutive}`);
  console.log(`Agent status records: ${data.agents.length}`);
  console.log(`Expected-income currencies: ${data.finance.expectedIncome.length}; received-income currencies: ${data.finance.receivedIncome.length}.`);
  console.log(`Recurring-income currencies: ${data.finance.recurringIncome.length}; expected-expense currencies: ${data.finance.expectedExpenses.length}.`);
  console.log('Recurring income and expected expenses match authoritative Finance persistence; projected profit correctly remains unavailable until a non-double-counting period basis exists.');
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await pool.end().catch(() => undefined);
}
