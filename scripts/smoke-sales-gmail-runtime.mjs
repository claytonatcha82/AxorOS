import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { registerSalesEmailCapabilities, SALES_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/sales-email-capabilities.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();

if (!clientId || !clientSecret || !refreshToken || !identitiesJson) {
  throw new Error('All AXOROS_GMAIL_* settings are required via Infisical.');
}

let identityAddresses;
try {
  identityAddresses = JSON.parse(identitiesJson);
} catch {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.');
}

const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) throw new Error('A sales Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  gmailClientId: clientId,
  gmailClientSecret: clientSecret,
  gmailRefreshToken: refreshToken,
  gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('email.gmail')) throw new Error('Gmail integration was not registered.');

const handlers = new AgentRuntimeHandlerRegistry();
registerSalesEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });

const now = new Date().toISOString();
const executionId = `sales-gmail-runtime-smoke-${Date.now()}`;
let execution = {
  task: {
    taskId: `task-${executionId}`,
    executionId,
    originAgent: 'operations_agent',
    destinationAgent: 'sales_agent',
    objective: 'Create one governed synthetic Gmail sales draft without sending',
    priority: 'normal',
    context: { testOnly: true },
    knowledgeReferences: ['atlas://synthetic/sales-email-runtime-smoke'],
    inputs: {
      fromIdentity: 'sales',
      to: [{ email: salesAddress }],
      subject: '[AxorOS TEST] Governed Sales runtime Gmail draft - DO NOT SEND',
      textBody: 'Synthetic AxorOS governed Sales runtime test. No client or prospect data was used. This is a draft only and must not be sent.',
    },
    expectedOutput: 'One governed Gmail draft',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 1,
    correlationId: `corr-${executionId}`,
    createdAt: now,
    updatedAt: now,
  },
  version: 1,
  persistedAt: now,
};
const events = [];
const idempotency = new Map();

const store = {
  async getExecution(id) { return execution.task.executionId === id ? execution : null; },
  async saveExecution(record, expectedVersion) {
    if (execution.version !== expectedVersion) throw new Error('runtime version conflict in smoke store.');
    execution = record;
  },
  async appendEvent(event) { events.push(event); },
  async listEvents(id) { return events.filter((event) => event.executionId === id); },
  async hasIdempotencyKey(key) { return idempotency.has(key); },
  async saveIdempotencyRecord(record) { idempotency.set(record.idempotencyKey, record); },
};

const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
const outcome = await orchestrator.execute({ executionId, capabilityId: SALES_EMAIL_DRAFT_CAPABILITY });

if (outcome.record.task.status !== 'completed' || outcome.record.result?.status !== 'completed') {
  throw new Error(`Governed Sales Gmail smoke test failed with runtime status ${outcome.record.task.status}: ${outcome.record.result?.errorMessage ?? 'unknown error'}`);
}
if (outcome.record.result.output.integrationId !== 'email.gmail') throw new Error('Sales runtime did not use email.gmail.');
if (outcome.record.result.output.mode !== 'draft') throw new Error('Sales runtime did not remain in draft mode.');
if (!outcome.record.result.output.draftId) throw new Error('Sales runtime did not return a Gmail draft ID.');

console.log('PASS governed Sales Agent -> Gmail draft runtime');
console.log(`Runtime status: ${outcome.record.task.status}`);
console.log(`Integration: ${outcome.record.result.output.integrationId}`);
console.log(`Provider: ${outcome.record.result.output.provider}`);
console.log(`Mode: ${outcome.record.result.output.mode}`);
console.log(`Draft ID: ${outcome.record.result.output.draftId}`);
console.log(`Audit events: ${events.length}`);
console.log('No email was sent. No client or prospect data was used.');
console.log('Open Gmail Drafts and confirm the governed AxorOS TEST draft is present.');
