import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { registerMarketingModelCapabilities, MARKETING_DRAFT_COPY_CAPABILITY } from '../apps/api/dist/agents/marketing-model-capabilities.js';
import { registerMarketingEmailCapabilities, MARKETING_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/marketing-email-capabilities.js';
import { applyMarketingEmailRuntimeApprovalPolicy } from '../apps/api/dist/agents/marketing-email-runtime-approval.js';
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
const marketingAddress = typeof identityAddresses?.marketing === 'string' ? identityAddresses.marketing.trim() : '';
if (!marketingAddress) throw new Error('A marketing Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173',
  geminiApiKey, ...(process.env.AXOROS_GEMINI_MODEL?.trim() ? { geminiModel: process.env.AXOROS_GEMINI_MODEL.trim() } : {}),
  gmailClientId, gmailClientSecret, gmailRefreshToken, gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('model.gemini') || !registeredIntegrationIds.includes('email.gmail')) {
  throw new Error('Gemini and Gmail integrations must both be registered.');
}

const handlers = new AgentRuntimeHandlerRegistry();
registerMarketingModelCapabilities(handlers, registry);
registerMarketingEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const modelExecutionId = `marketing-gemini-stage1-${suffix}`;
const emailExecutionId = `marketing-gmail-stage1-${suffix}`;
const now = new Date().toISOString();
const requiredPhrase = 'website strategy';
const forbiddenPatterns = [
  /guarantee(?:d|s)?/i,
  /\b\d+%\b/,
  /trusted by/i,
  /limited time/i,
  /special (?:price|rate|discount)/i,
];
const modelRecord = {
  task: {
    taskId: `task-${modelExecutionId}`, executionId: modelExecutionId, originAgent: 'operations_agent', destinationAgent: 'marketing_agent',
    objective: 'Draft synthetic evidence-bounded educational Marketing copy', priority: 'normal', context: { testOnly: true },
    knowledgeReferences: ['atlas://marketing/communication-governance'],
    inputs: {
      brief: 'Write a short professional educational email for a synthetic AxorOS marketing test. The topic is website strategy for growing businesses. Include the exact phrase "website strategy". Keep it informative and brand-appropriate. Do not use personalised prospect outreach, pricing, discounts, guarantees, testimonials, customer statistics, fabricated results, urgency, scarcity, or claims that the message has been approved or sent.',
      context: 'SYNTHETIC TEST CONTEXT ONLY. The only approved fact is that the content topic is website strategy. There are no real clients, prospects, testimonials, campaign results, prices, mailing lists, performance statistics, or case-study claims. Unknown facts must remain unknown. This is marketing content, not a Sales conversation.',
    },
    expectedOutput: 'Safe synthetic educational Marketing email copy', dependencies: [], risks: [], confidence: 1, approvalRequired: false,
    status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1,
    correlationId: `corr-${suffix}`, createdAt: now, updatedAt: now,
  }, version: 1, persistedAt: now,
};

const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-marketing-gemini-gmail-stage1-workflow' });
try {
  const store = createAgentRuntimePostgresStore(pool);
  await store.saveExecution(modelRecord, 0);
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const modelOutcome = await orchestrator.execute({ executionId: modelExecutionId, capabilityId: MARKETING_DRAFT_COPY_CAPABILITY });
  const generatedText = modelOutcome.record.result?.output?.text;
  if (modelOutcome.record.task.status !== 'completed' || typeof generatedText !== 'string' || !generatedText.trim()) {
    throw new Error(`Marketing Gemini stage failed: ${modelOutcome.record.result?.errorMessage ?? modelOutcome.record.task.status}`);
  }
  if (!generatedText.toLowerCase().includes(requiredPhrase)) throw new Error('Marketing Gemini output did not preserve the required website strategy topic.');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(generatedText)) throw new Error(`Marketing Gemini output contained a prohibited or unsupported claim pattern: ${pattern}.`);
  }

  const emailNow = new Date().toISOString();
  const rawEmailTask = {
    taskId: `task-${emailExecutionId}`, executionId: emailExecutionId, originAgent: 'operations_agent', destinationAgent: 'marketing_agent',
    objective: 'Place governed Gemini-generated synthetic Marketing copy into Gmail Drafts after Stage 1 Human Executive approval', priority: 'normal',
    context: { environment: 'development', controlledApprovalSmoke: true, sourceExecutionId: modelExecutionId, recipientClass: 'self-test-mailbox' },
    knowledgeReferences: modelOutcome.record.result.knowledgeReferences,
    inputs: { fromIdentity: 'marketing', to: [{ email: marketingAddress }], subject: '[AxorOS TEST] Gemini -> approved Marketing Gmail draft - DO NOT SEND', textBody: generatedText.trim() },
    expectedOutput: 'One Human Executive-approved Gmail draft containing governed Marketing model output', dependencies: [modelRecord.task.taskId], risks: [], confidence: 1,
    approvalRequired: false, status: 'ready', nextAction: 'apply_marketing_email_policy', attempt: 1, maxAttempts: 1,
    correlationId: modelRecord.task.correlationId, createdAt: emailNow, updatedAt: emailNow,
  };
  const emailTask = applyMarketingEmailRuntimeApprovalPolicy(rawEmailTask);
  await store.saveExecution({ task: emailTask, version: 1, persistedAt: emailNow }, 0);

  const review = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: MARKETING_EMAIL_DRAFT_CAPABILITY });
  if (review.record.task.status !== 'review' || review.record.task.approvalOwner !== 'human_executive') {
    throw new Error('Marketing Gmail stage did not stop for Human Executive approval.');
  }
  if (review.record.result?.output?.draftId) throw new Error('A Gmail draft existed before Human Executive approval.');

  const approved = await orchestrator.resolveApproval({
    executionId: emailExecutionId, actor: 'human_executive', decision: 'approved',
    reason: 'Controlled synthetic Marketing Gemini-to-Gmail Stage 1 smoke approved for draft creation only.',
  });
  if (approved.record.task.status !== 'ready' || approved.record.task.approvalRequired) {
    throw new Error('Approved Marketing email task did not return to ready state.');
  }

  const emailOutcome = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: MARKETING_EMAIL_DRAFT_CAPABILITY });
  if (emailOutcome.record.task.status !== 'completed' || emailOutcome.record.result?.status !== 'completed') {
    throw new Error(`Marketing Gmail stage failed: ${emailOutcome.record.result?.errorMessage ?? emailOutcome.record.task.status}`);
  }
  if (emailOutcome.record.result.output.integrationId !== 'email.gmail' || emailOutcome.record.result.output.mode !== 'draft' || !emailOutcome.record.result.output.draftId) {
    throw new Error('Marketing Gmail stage did not return governed draft evidence.');
  }

  const modelEvents = await store.listEvents(modelExecutionId);
  const emailEvents = await store.listEvents(emailExecutionId);
  if (!emailEvents.some((event) => event.type === 'approval_requested') || !emailEvents.some((event) => event.type === 'approval_granted')) {
    throw new Error('Marketing Stage 1 approval audit evidence is missing.');
  }
  console.log('PASS governed Marketing Gemini -> Human Executive approval -> Gmail draft workflow');
  console.log(`Model provider: ${modelOutcome.record.result.output.provider}`);
  console.log(`Email provider: ${emailOutcome.record.result.output.provider}`);
  console.log(`Mode: ${emailOutcome.record.result.output.mode}`);
  console.log(`Draft ID: ${emailOutcome.record.result.output.draftId}`);
  console.log(`Model audit events: ${modelEvents.length}`);
  console.log(`Email audit events: ${emailEvents.length}`);
  console.log('Marketing model output remained evidence-bounded and preserved the website strategy topic without prohibited claim patterns.');
  console.log('No email was sent. No campaign was launched. No real client, prospect, mailing-list, testimonial, pricing, or performance data was used.');
  console.log('Open Gmail Drafts and review the AxorOS TEST Marketing draft. Do not send it.');
} finally {
  for (const executionId of [emailExecutionId, modelExecutionId]) {
    await pool.query('delete from runtime.agent_events where execution_id = $1', [executionId]).catch(() => undefined);
    await pool.query('delete from runtime.idempotency_records where execution_id = $1', [executionId]).catch(() => undefined);
    await pool.query('delete from runtime.agent_executions where execution_id = $1', [executionId]).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
}
