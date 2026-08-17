import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { registerFinanceModelCapabilities, FINANCE_ANALYSIS_CAPABILITY } from '../apps/api/dist/agents/finance-model-capabilities.js';
import { registerFinanceEmailCapabilities, FINANCE_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/finance-email-capabilities.js';
import { applyFinanceEmailRuntimeApprovalPolicy } from '../apps/api/dist/agents/finance-email-runtime-approval.js';
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
const financeAddress = typeof identityAddresses?.finance === 'string' ? identityAddresses.finance.trim() : '';
if (!financeAddress) throw new Error('A finance Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173',
  geminiApiKey, ...(process.env.AXOROS_GEMINI_MODEL?.trim() ? { geminiModel: process.env.AXOROS_GEMINI_MODEL.trim() } : {}),
  gmailClientId, gmailClientSecret, gmailRefreshToken, gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('model.gemini') || !registeredIntegrationIds.includes('email.gmail')) {
  throw new Error('Gemini and Gmail integrations must both be registered.');
}

const handlers = new AgentRuntimeHandlerRegistry();
registerFinanceModelCapabilities(handlers, registry);
registerFinanceEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const modelExecutionId = `finance-gemini-stage1-${suffix}`;
const emailExecutionId = `finance-gmail-stage1-${suffix}`;
const now = new Date().toISOString();
const modelRecord = {
  task: {
    taskId: `task-${modelExecutionId}`, executionId: modelExecutionId, originAgent: 'operations_agent', destinationAgent: 'finance_agent',
    objective: 'Analyse synthetic Finance evidence and draft a cautious client-facing clarification message', priority: 'normal', context: { testOnly: true },
    knowledgeReferences: ['atlas://finance/governance'],
    inputs: {
      financeBrief: 'Using only the supplied synthetic context, write a short professional client-facing billing clarification message. State that the payment status is awaiting verification and ask the fictional client to confirm the payment reference if available. Do not claim payment was received, do not invent an invoice number, amount, due date, penalty, tax fact, refund, discount, bank detail, payment instruction, or legal consequence.',
      financeContext: 'SYNTHETIC TEST CONTEXT ONLY. A fictional client says they made a payment, but there is no payment-provider evidence and no governed ledger confirmation. Under Atlas Finance governance, client statements are not proof of payment. The correct status is Payment awaiting verification. No real client, invoice, payment, bank information, or financial record exists.',
    },
    expectedOutput: 'Safe synthetic Finance clarification draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false,
    status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1,
    correlationId: `corr-${suffix}`, createdAt: now, updatedAt: now,
  }, version: 1, persistedAt: now,
};

let pool = new Pool({ connectionString, max: 1, application_name: 'axoros-finance-gemini-gmail-stage1-workflow' });
try {
  const store = createAgentRuntimePostgresStore(pool);
  await store.saveExecution(modelRecord, 0);
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const modelOutcome = await orchestrator.execute({ executionId: modelExecutionId, capabilityId: FINANCE_ANALYSIS_CAPABILITY });
  const generatedText = modelOutcome.record.result?.output?.text;
  if (modelOutcome.record.task.status !== 'completed' || typeof generatedText !== 'string' || !generatedText.trim()) {
    throw new Error(`Finance Gemini stage failed: ${modelOutcome.record.result?.errorMessage ?? modelOutcome.record.task.status}`);
  }

  const normalized = generatedText.toLowerCase();
  if (!normalized.includes('awaiting verification')) throw new Error('Finance Gemini output did not preserve the required awaiting-verification status.');
  if (/payment (?:has been |was |is )?(?:received|confirmed|settled|successful)/i.test(generatedText)) {
    throw new Error('Finance Gemini output asserted an unverified successful payment state.');
  }

  const emailNow = new Date().toISOString();
  const rawEmailTask = {
    taskId: `task-${emailExecutionId}`, executionId: emailExecutionId, originAgent: 'operations_agent', destinationAgent: 'finance_agent',
    objective: 'Place governed Gemini-generated synthetic Finance copy into Gmail Drafts after Stage 1 Human Executive approval', priority: 'normal',
    context: { environment: 'development', controlledApprovalSmoke: true, sourceExecutionId: modelExecutionId, recipientClass: 'self-test-mailbox' },
    knowledgeReferences: modelOutcome.record.result.knowledgeReferences,
    inputs: { fromIdentity: 'finance', to: [{ email: financeAddress }], subject: '[AxorOS TEST] Gemini -> approved Finance Gmail draft - DO NOT SEND', textBody: generatedText.trim() },
    expectedOutput: 'One Human Executive-approved Gmail draft containing governed Finance model output', dependencies: [modelRecord.task.taskId], risks: [], confidence: 1,
    approvalRequired: false, status: 'ready', nextAction: 'apply_finance_email_policy', attempt: 1, maxAttempts: 1,
    correlationId: modelRecord.task.correlationId, createdAt: emailNow, updatedAt: emailNow,
  };
  const emailTask = applyFinanceEmailRuntimeApprovalPolicy(rawEmailTask);
  await store.saveExecution({ task: emailTask, version: 1, persistedAt: emailNow }, 0);

  const review = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY });
  if (review.record.task.status !== 'review' || review.record.task.approvalOwner !== 'human_executive') {
    throw new Error('Finance Gmail stage did not stop for Human Executive approval.');
  }
  if (review.record.result?.output?.draftId) throw new Error('A Gmail draft existed before Human Executive approval.');

  const approved = await orchestrator.resolveApproval({
    executionId: emailExecutionId, actor: 'human_executive', decision: 'approved',
    reason: 'Controlled synthetic Finance Gemini-to-Gmail Stage 1 smoke approved for draft creation only.',
  });
  if (approved.record.task.status !== 'ready' || approved.record.task.approvalRequired) {
    throw new Error('Approved Finance email task did not return to ready state.');
  }

  const emailOutcome = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY });
  if (emailOutcome.record.task.status !== 'completed' || emailOutcome.record.result?.status !== 'completed') {
    throw new Error(`Finance Gmail stage failed: ${emailOutcome.record.result?.errorMessage ?? emailOutcome.record.task.status}`);
  }
  if (emailOutcome.record.result.output.integrationId !== 'email.gmail' || emailOutcome.record.result.output.mode !== 'draft' || !emailOutcome.record.result.output.draftId) {
    throw new Error('Finance Gmail stage did not return governed draft evidence.');
  }

  const modelEvents = await store.listEvents(modelExecutionId);
  const emailEvents = await store.listEvents(emailExecutionId);
  if (!emailEvents.some((event) => event.type === 'approval_requested') || !emailEvents.some((event) => event.type === 'approval_granted')) {
    throw new Error('Finance Stage 1 approval audit evidence is missing.');
  }
  console.log('PASS governed Finance Gemini -> Human Executive approval -> Gmail draft workflow');
  console.log(`Model provider: ${modelOutcome.record.result.output.provider}`);
  console.log(`Email provider: ${emailOutcome.record.result.output.provider}`);
  console.log(`Mode: ${emailOutcome.record.result.output.mode}`);
  console.log(`Draft ID: ${emailOutcome.record.result.output.draftId}`);
  console.log(`Model audit events: ${modelEvents.length}`);
  console.log(`Email audit events: ${emailEvents.length}`);
  console.log('Finance model output preserved Payment awaiting verification and did not assert successful payment.');
  console.log('No email was sent. No payment was executed. No real client or financial data was used.');
  console.log('Open Gmail Drafts and review the AxorOS TEST Finance draft. Do not send it.');
} finally {
  for (const executionId of [emailExecutionId, modelExecutionId]) {
    await pool.query('delete from runtime.agent_events where execution_id = $1', [executionId]).catch(() => undefined);
    await pool.query('delete from runtime.idempotency_records where execution_id = $1', [executionId]).catch(() => undefined);
    await pool.query('delete from runtime.agent_executions where execution_id = $1', [executionId]).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
}
