import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { registerSalesModelCapabilities, SALES_DRAFT_RESPONSE_CAPABILITY } from '../apps/api/dist/agents/sales-model-capabilities.js';
import { registerSalesEmailCapabilities, SALES_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/sales-email-capabilities.js';
import { createAgentRuntimePostgresStore } from '../apps/api/dist/data/agent-runtime-postgres-store.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const { Pool } = pg;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
};

const connectionString = required('AXOROS_DATABASE_URL');
const geminiApiKey = required('GEMINI_API_KEY');
const gmailClientId = required('AXOROS_GMAIL_CLIENT_ID');
const gmailClientSecret = required('AXOROS_GMAIL_CLIENT_SECRET');
const gmailRefreshToken = required('AXOROS_GMAIL_REFRESH_TOKEN');
const identitiesJson = required('AXOROS_GMAIL_IDENTITY_ADDRESSES');
let identityAddresses;
try { identityAddresses = JSON.parse(identitiesJson); } catch { throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.'); }
const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) throw new Error('A sales Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173',
  geminiApiKey, ...(process.env.AXOROS_GEMINI_MODEL?.trim() ? { geminiModel: process.env.AXOROS_GEMINI_MODEL.trim() } : {}),
  gmailClientId, gmailClientSecret, gmailRefreshToken, gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('model.gemini') || !registeredIntegrationIds.includes('email.gmail')) {
  throw new Error('Gemini and Gmail integrations must both be registered.');
}

const handlers = new AgentRuntimeHandlerRegistry();
registerSalesModelCapabilities(handlers, registry);
registerSalesEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const modelExecutionId = `sales-gemini-workflow-${suffix}`;
const emailExecutionId = `sales-gmail-workflow-${suffix}`;
const now = new Date().toISOString();
const modelRecord = {
  task: {
    taskId: `task-${modelExecutionId}`, executionId: modelExecutionId, originAgent: 'operations_agent', destinationAgent: 'sales_agent',
    objective: 'Draft synthetic sales follow-up copy from approved synthetic context', priority: 'normal', context: { testOnly: true },
    knowledgeReferences: ['atlas://synthetic/sales-gemini-gmail-workflow'],
    inputs: {
      salesBrief: 'Draft a short professional follow-up email to a fictional business contact who requested information about a website redesign. Do not include prices, promises, dates, discounts, guarantees, payment terms, or invented facts. End by inviting them to discuss their requirements.',
      salesContext: 'SYNTHETIC TEST CONTEXT ONLY. No real client or prospect exists. AxorOS is testing a governed draft workflow. No commercial terms have been approved.',
    },
    expectedOutput: 'Safe synthetic sales email body draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false,
    status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1,
    correlationId: `corr-${suffix}`, createdAt: now, updatedAt: now,
  }, version: 1, persistedAt: now,
};

let pool = new Pool({ connectionString, max: 1, application_name: 'axoros-sales-gemini-gmail-workflow' });
try {
  const store = createAgentRuntimePostgresStore(pool);
  await store.saveExecution(modelRecord, 0);
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const modelOutcome = await orchestrator.execute({ executionId: modelExecutionId, capabilityId: SALES_DRAFT_RESPONSE_CAPABILITY });
  const generatedText = modelOutcome.record.result?.output?.text;
  if (modelOutcome.record.task.status !== 'completed' || typeof generatedText !== 'string' || !generatedText.trim()) {
    throw new Error(`Sales Gemini stage failed: ${modelOutcome.record.result?.errorMessage ?? modelOutcome.record.task.status}`);
  }

  const emailNow = new Date().toISOString();
  const emailRecord = {
    task: {
      taskId: `task-${emailExecutionId}`, executionId: emailExecutionId, originAgent: 'operations_agent', destinationAgent: 'sales_agent',
      objective: 'Place the governed Gemini-generated synthetic sales copy into Gmail Drafts without sending', priority: 'normal', context: { testOnly: true, sourceExecutionId: modelExecutionId },
      knowledgeReferences: modelOutcome.record.result.knowledgeReferences,
      inputs: { fromIdentity: 'sales', to: [{ email: salesAddress }], subject: '[AxorOS TEST] Gemini -> governed Sales Gmail draft - DO NOT SEND', textBody: generatedText.trim() },
      expectedOutput: 'One governed Gmail draft containing the model-produced synthetic sales copy', dependencies: [modelRecord.task.taskId], risks: [], confidence: 1,
      approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1,
      correlationId: modelRecord.task.correlationId, createdAt: emailNow, updatedAt: emailNow,
    }, version: 1, persistedAt: emailNow,
  };
  await store.saveExecution(emailRecord, 0);
  const emailOutcome = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: SALES_EMAIL_DRAFT_CAPABILITY });
  if (emailOutcome.record.task.status !== 'completed' || emailOutcome.record.result?.status !== 'completed') {
    throw new Error(`Sales Gmail stage failed: ${emailOutcome.record.result?.errorMessage ?? emailOutcome.record.task.status}`);
  }
  if (emailOutcome.record.result.output.integrationId !== 'email.gmail' || !emailOutcome.record.result.output.draftId) {
    throw new Error('Gmail stage did not return governed draft evidence.');
  }

  const modelEvents = await store.listEvents(modelExecutionId);
  const emailEvents = await store.listEvents(emailExecutionId);
  console.log('PASS governed Sales Gemini -> Gmail draft workflow');
  console.log(`Model provider: ${modelOutcome.record.result.output.provider}`);
  console.log(`Email provider: ${emailOutcome.record.result.output.provider}`);
  console.log(`Mode: ${emailOutcome.record.result.output.mode}`);
  console.log(`Model audit events: ${modelEvents.length}`);
  console.log(`Email audit events: ${emailEvents.length}`);
  console.log('Gemini generated the synthetic copy; Gmail stored it as a draft.');
  console.log('No email was sent. No client or prospect data was used.');
  console.log('Open Gmail Drafts and review the AxorOS TEST draft. Do not send it.');
} finally {
  for (const executionId of [emailExecutionId, modelExecutionId]) {
    await pool.query('delete from runtime.agent_events where execution_id = $1', [executionId]).catch(() => undefined);
    await pool.query('delete from runtime.idempotency_records where execution_id = $1', [executionId]).catch(() => undefined);
    await pool.query('delete from runtime.agent_executions where execution_id = $1', [executionId]).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
}
