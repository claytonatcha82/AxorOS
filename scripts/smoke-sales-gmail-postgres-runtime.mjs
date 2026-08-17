import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { registerSalesEmailCapabilities, SALES_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/sales-email-capabilities.js';
import { createAgentRuntimePostgresStore } from '../apps/api/dist/data/agent-runtime-postgres-store.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL?.trim();
const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();

if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required via Infisical.');
if (!clientId || !clientSecret || !refreshToken || !identitiesJson) throw new Error('All AXOROS_GMAIL_* settings are required via Infisical.');

let identityAddresses;
try { identityAddresses = JSON.parse(identitiesJson); } catch { throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.'); }
const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) throw new Error('A sales Gmail identity is required.');

const { registry } = createConfiguredIntegrationRegistry({
  environment: 'development', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173',
  gmailClientId: clientId, gmailClientSecret: clientSecret, gmailRefreshToken: refreshToken, gmailIdentityAddresses: identityAddresses,
});
const handlers = new AgentRuntimeHandlerRegistry();
registerSalesEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const executionId = `sales-gmail-pg-smoke-${suffix}`;
const now = new Date().toISOString();
const initialRecord = {
  task: {
    taskId: `task-${executionId}`, executionId, originAgent: 'operations_agent', destinationAgent: 'sales_agent',
    objective: 'Create one durable governed synthetic Gmail sales draft without sending', priority: 'normal', context: { testOnly: true },
    knowledgeReferences: ['atlas://synthetic/sales-email-postgres-runtime-smoke'],
    inputs: { fromIdentity: 'sales', to: [{ email: salesAddress }], subject: '[AxorOS TEST] Durable governed Sales Gmail draft - DO NOT SEND', textBody: 'Synthetic durable AxorOS Sales runtime test. No client or prospect data was used. This is a draft only and must not be sent.' },
    expectedOutput: 'One durable governed Gmail draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false,
    status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1,
    correlationId: `corr-${executionId}`, createdAt: now, updatedAt: now,
  },
  version: 1,
  persistedAt: now,
};

let pool = new Pool({ connectionString, max: 1, application_name: 'axoros-sales-gmail-pg-smoke' });
try {
  const store = createAgentRuntimePostgresStore(pool);
  await store.saveExecution(initialRecord, 0);
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const outcome = await orchestrator.execute({ executionId, capabilityId: SALES_EMAIL_DRAFT_CAPABILITY });
  if (outcome.record.task.status !== 'completed' || outcome.record.result?.status !== 'completed') {
    throw new Error(`runtime failed: ${outcome.record.result?.errorMessage ?? outcome.record.task.status}`);
  }
  const draftId = outcome.record.result.output.draftId;
  if (!draftId) throw new Error('runtime did not return a Gmail draft ID.');
  await pool.end();

  pool = new Pool({ connectionString, max: 1, application_name: 'axoros-sales-gmail-pg-smoke-restart' });
  const restartedStore = createAgentRuntimePostgresStore(pool);
  const persisted = await restartedStore.getExecution(executionId);
  const events = await restartedStore.listEvents(executionId);
  if (!persisted || persisted.task.status !== 'completed' || persisted.result?.status !== 'completed') throw new Error('completed Sales execution did not survive database connection restart.');
  if (persisted.result.output.draftId !== draftId) throw new Error('persisted Gmail draft evidence does not match runtime result.');
  if (events.length < 2) throw new Error('expected runtime audit events were not durably persisted.');

  console.log('PASS durable governed Sales Agent -> Gmail draft runtime');
  console.log('Runtime state survived database connection restart.');
  console.log(`Provider: ${persisted.result.output.provider}`);
  console.log(`Mode: ${persisted.result.output.mode}`);
  console.log(`Audit events persisted: ${events.length}`);
  console.log('Gmail draft evidence persisted with the runtime result.');
  console.log('No email was sent. No client or prospect data was used.');
  console.log('Open Gmail Drafts and confirm the durable AxorOS TEST draft is present.');
} finally {
  await pool.query('delete from runtime.agent_events where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.query('delete from runtime.idempotency_records where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.query('delete from runtime.agent_executions where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
