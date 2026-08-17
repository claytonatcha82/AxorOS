import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { applyFinanceEmailRuntimeApprovalPolicy } from '../apps/api/dist/agents/finance-email-runtime-approval.js';
import { registerFinanceEmailCapabilities, FINANCE_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/finance-email-capabilities.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();
if (!clientId || !clientSecret || !refreshToken || !identitiesJson) throw new Error('All AXOROS_GMAIL_* settings are required via Infisical.');
let identityAddresses;
try { identityAddresses = JSON.parse(identitiesJson); } catch { throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.'); }
const financeAddress = typeof identityAddresses?.finance === 'string' ? identityAddresses.finance.trim() : '';
if (!financeAddress) throw new Error('A finance Gmail identity is required in AXOROS_GMAIL_IDENTITY_ADDRESSES before this smoke can run.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173',
  gmailClientId: clientId, gmailClientSecret: clientSecret, gmailRefreshToken: refreshToken, gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('email.gmail')) throw new Error('Gmail integration was not registered.');
const handlers = new AgentRuntimeHandlerRegistry();
registerFinanceEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });
const now = new Date().toISOString();
const executionId = `finance-gmail-stage1-approval-${Date.now()}`;
const rawTask = {
  taskId: `task-${executionId}`, executionId, originAgent: 'operations_agent', destinationAgent: 'finance_agent',
  objective: 'Validate Atlas Finance Stage 1 human approval before creating a real Gmail draft', priority: 'normal',
  context: { environment: 'development', controlledApprovalSmoke: true, recipientClass: 'self-test-mailbox' },
  knowledgeReferences: ['atlas://finance/governance'],
  inputs: { fromIdentity: 'finance', to: [{ email: financeAddress }], subject: '[AxorOS TEST] Stage 1 approved Finance Gmail draft - DO NOT SEND', textBody: 'Synthetic AxorOS Finance Stage 1 approval test. Human Executive approval was required before this Gmail draft could be created. No payment status, invoice fact, client data, or real financial instruction is asserted. Do not send.' },
  expectedOutput: 'One human-approved Finance Gmail draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false,
  status: 'ready', nextAction: 'apply_finance_email_policy', attempt: 1, maxAttempts: 1, correlationId: `corr-${executionId}`, createdAt: now, updatedAt: now,
};
let execution = { task: applyFinanceEmailRuntimeApprovalPolicy(rawTask), version: 1, persistedAt: now };
const events = []; const idempotency = new Map();
const store = {
  async getExecution(id) { return execution.task.executionId === id ? execution : null; },
  async saveExecution(record, expectedVersion) { if (execution.version !== expectedVersion) throw new Error('runtime version conflict in Finance Stage 1 smoke store.'); execution = record; },
  async appendEvent(event) { events.push(event); }, async listEvents(id) { return events.filter((event) => event.executionId === id); },
  async hasIdempotencyKey(key) { return idempotency.has(key); }, async saveIdempotencyRecord(record) { idempotency.set(record.idempotencyKey, record); },
};
const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
const review = await orchestrator.execute({ executionId, capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY });
if (review.record.task.status !== 'review') throw new Error(`Expected review before approval, got ${review.record.task.status}.`);
if (review.record.task.approvalOwner !== 'human_executive') throw new Error('Finance Stage 1 approval owner must be human_executive.');
if (review.record.result?.output?.draftId) throw new Error('A Gmail draft existed before Human Executive approval.');
const approved = await orchestrator.resolveApproval({ executionId, actor: 'human_executive', decision: 'approved', reason: 'Controlled self-recipient Finance Stage 1 smoke approved for draft creation only.' });
if (approved.record.task.status !== 'ready' || approved.record.task.approvalRequired) throw new Error('Approved Finance task did not return to ready state.');
const completed = await orchestrator.execute({ executionId, capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY });
if (completed.record.task.status !== 'completed' || completed.record.result?.status !== 'completed') throw new Error(`Approved Finance Gmail draft execution failed with ${completed.record.task.status}.`);
if (completed.record.result.output.integrationId !== 'email.gmail' || completed.record.result.output.mode !== 'draft' || !completed.record.result.output.draftId) throw new Error('Finance Gmail draft evidence was incomplete.');
if (!events.some((event) => event.type === 'approval_requested') || !events.some((event) => event.type === 'approval_granted')) throw new Error('Finance approval audit evidence missing.');
console.log('PASS real Gmail Finance Stage 1 approval lifecycle');
console.log('Before approval: runtime stopped in review and no Gmail draft was created.');
console.log('Approval actor: human_executive');
console.log(`After approval: ${completed.record.task.status}`);
console.log(`Provider: ${completed.record.result.output.provider}`);
console.log(`Mode: ${completed.record.result.output.mode}`);
console.log(`Draft ID: ${completed.record.result.output.draftId}`);
console.log(`Audit events: ${events.length}`);
console.log('No email was sent. No payment was executed. No client data was used.');
console.log('Open Gmail Drafts and confirm the Finance Stage 1 AxorOS TEST draft is present.');
