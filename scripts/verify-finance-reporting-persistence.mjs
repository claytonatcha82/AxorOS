import assert from 'node:assert/strict';
import pg from 'pg';
import {
  FinanceExpensePostgresStore,
  FinanceReportingIntegrityConflictError,
  FinanceSubscriptionPostgresStore,
} from '../apps/api/dist/data/finance-reporting-postgres-store.js';
import { createExecutiveDashboardService } from '../apps/api/dist/dashboard/executive-dashboard-service.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL?.trim();
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required via Infisical.');

const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-finance-reporting-verify' });
const expenses = new FinanceExpensePostgresStore(pool);
const subscriptions = new FinanceSubscriptionPostgresStore(pool);
const dashboard = createExecutiveDashboardService(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const expenseId = `expense:verify:${suffix}`;
const subscriptionId = `subscription:verify:${suffix}`;
const clientName = `Finance reporting verifier ${suffix}`;
let clientId;

function amount(items, currency) {
  return items.find((item) => item.currency === currency)?.amountMinor ?? 0;
}

try {
  const client = await pool.query(
    `insert into operational.clients (display_name, status, primary_email)
     values ($1, 'prospect', $2) returning id`,
    [clientName, `finance-reporting-${suffix}@example.invalid`],
  );
  clientId = String(client.rows[0].id);

  const baseline = await dashboard.snapshot();
  const baselineMrr = amount(baseline.finance.recurringIncome, 'ZAR');
  const baselineExpenses = amount(baseline.finance.expectedExpenses, 'ZAR');
  const today = new Date();
  const date = today.toISOString().slice(0, 10);

  const expense = {
    expenseId,
    category: 'SOFTWARE',
    vendor: 'Synthetic Pilot Vendor',
    description: 'Synthetic annual software cost for Finance reporting verification.',
    amountMinor: 120000,
    currency: 'ZAR',
    billingType: 'RECURRING',
    billingPeriod: 'ANNUAL',
    expenseDate: date,
    status: 'PLANNED',
    approvedBy: 'human_executive',
    evidenceReferences: [`verify://finance-reporting/${expenseId}`],
  };
  const subscription = {
    subscriptionId,
    clientId,
    service: 'Synthetic maintenance plan',
    billingFrequency: 'QUARTERLY',
    amountMinor: 300000,
    currency: 'ZAR',
    startDate: date,
    nextBillingDate: date,
    status: 'ACTIVE',
    autoRenew: false,
    invoicePolicy: 'Synthetic verifier only; no invoice or payment action.',
    commercialReference: `verify-commercial:${suffix}`,
    evidenceReferences: [`verify://finance-reporting/${subscriptionId}`],
    approvedBy: 'human_executive',
  };

  assert.equal(await expenses.save(expense), 'accepted');
  assert.equal(await expenses.save({ ...expense }), 'duplicate');
  await assert.rejects(
    expenses.save({ ...expense, amountMinor: expense.amountMinor + 1 }),
    FinanceReportingIntegrityConflictError,
  );

  assert.equal(await subscriptions.save(subscription), 'accepted');
  assert.equal(await subscriptions.save({ ...subscription }), 'duplicate');
  await assert.rejects(
    subscriptions.save({ ...subscription, amountMinor: subscription.amountMinor + 1 }),
    FinanceReportingIntegrityConflictError,
  );

  await assert.rejects(
    expenses.save({ ...expense, expenseId: `${expenseId}:unauthorised`, approvedBy: 'finance_agent' }),
    /Human Executive approval provenance/,
  );

  const after = await dashboard.snapshot();
  assert.equal(amount(after.finance.recurringIncome, 'ZAR') - baselineMrr, 100000);
  assert.equal(amount(after.finance.expectedExpenses, 'ZAR') - baselineExpenses, 10000);
  assert.equal(after.finance.projectedProfit[0]?.available, false);

  console.log('PASS  Finance reporting persistence and dashboard monthly-equivalent totals verified.');
  console.log('Subscription MRR delta: ZAR 1,000.00');
  console.log('Expected expense delta: ZAR 100.00');
  console.log('Replay conflicts fail closed; Human Executive provenance enforced.');
  console.log('Synthetic records only; no payment, invoice, email, or client action occurred.');
} finally {
  await pool.query('delete from finance.subscriptions where subscription_id = $1', [subscriptionId]).catch(() => undefined);
  await pool.query('delete from finance.expenses where expense_id like $1', [`${expenseId}%`]).catch(() => undefined);
  if (clientId) await pool.query('delete from operational.clients where id = $1', [clientId]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
