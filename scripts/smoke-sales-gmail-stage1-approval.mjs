import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { applySalesEmailRuntimeApprovalPolicy } from '../apps/api/dist/agents/sales-email-runtime-approval.js';
import { registerSalesEmailCapabilities, SALES_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/sales-email-capabilities.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();
if (!clientId || !clientSecret || !refreshToken || !identitiesJson) throw new Error('All AXOROS_GMAIL_* settings are required via Infisical.');

let identityAddresses;
try { identityAddresses = JSON.parse(identitiesJson); } catch { throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.'); }
const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) throw new Error('A sales Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173',
  gmailClientId: clientId, gmailClientSecret: clientSecret, gmailRefreshToken: refreshToken, gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('email.gmail')) throw new Error('Gmail integration was not registered.');

const handlers = new AgentRuntimeHandlerRegistry();
registerSalesEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });
const now = new Date().toISOString();
const executionId = `sales-gmail-stage1-approval-${Date.now()}`;
const rawTask = {
  taskId: `task-${executionId}`, executionId, originAgent: 'operations_agent', destinationAgent: 'sales_agent',
  objective: 'Validate Atlas Stage 1 human approval before creating a real Gmail draft', priority: 'normal',
  context: { environment: 'development', controlledApprovalSmoke: true, recipientClass: 'self-test-mailbox' },
  knowledgeReferences: ['atlas://sales/outreach-policy'],
  inputs: { fromIdentity: 'sales', to: [{ email: salesAddress }], subject: '[AxorOS TEST] Stage 1 approved Sales Gmail draft - DO NOT SEND', textBody: 'Synthetic AxorOS Stage 1 approval test. Human Executive approval was required before this Gmail draft could be created. No client or prospect data was used. Do not send.' },
  expectedOutput: 'One human-approved Gmail draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false,
  status: 'ready', nextAction: 'apply_sales_email_policy', attempt: 1, maxAttempts: 1, correlationId: `corr-${executionId}`, createdAt: now, updatedAt: now,
};
let execution = { task: applySalesEmailRuntimeApprovalPolicy(rawTask), version: 1, persistedAt: now };
const events = [];
const idempotency = new Map();
const store = {
  async getExecution(id) { return execution.task.executionId === id ? execution : null; },
  async saveExecution(record, expectedVersion) { if (execution.version !== expectedVersion) throw new Error('runtime version conflict in Stage 1 smoke store.'); execution = record; },
  async appendEvent(event) { events.push(event); },
  async listEvents(id) { return events.filter((event) => event.executionId === id); },
  async hasIdempotencyKey(key) { return idempotency.has(key); },
  async saveIdempotencyRecord(record) { idempotency.set(record.idempotencyKey, record); },
};
const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });

const review = await orchestrator.execute({ executionId, capabilityId: SALES_EMAIL_DRAFT_CAPABILITY });
if (review.record.task.status !== 'review') throw new Error(`Expected review before approval, got ${review.record.task.status}.`);
if (review.record.task.approvalOwner !== 'human_executive') throw new Error('Stage 1 approval owner must be human_executive.');
if (review.record.result?.output?.draftId) throw new Error('A Gmail draft existed before Human Executive approval.');

const approved = await orchestrator.resolveApproval({ executionId, actor: 'human_executive', decision: 'approved', reason: 'Controlled self-recipient Stage 1 smoke approved for draft creation only.' });
if (approved.record.task.status !== 'ready' || approved.record.task.approvalRequired) throw new Error('Approved task did not return to ready state.');

const completed = await orchestrator.execute({ executionId, capabilityId: SALES_EMAIL_DRAFT_CAPABILITY });
if (completed.record.task.status !== 'completed' || completed.record.result?.status !== 'completed') throw new Error(`Approved Gmail draft execution failed with ${completed.record.task.status}.`);
if (completed.record.result.output.integrationId !== 'email.gmail') throw new Error('Approved runtime did not use email.gmail.');
if (completed.record.result.output.mode !== 'draft') throw new Error('Approved runtime did not remain in draft mode.');
if (!completed.record.result.output.draftId) throw new Error('Approved runtime did not return a Gmail draft ID.');
if (!events.some((event) => event.type === 'approval_requested')) throw new Error('Approval request audit event missing.');
if (!events.some((event) => event.type === 'approval_granted')) throw new Error('Approval granted audit event missing.');

console.log('PASS real Gmail Stage 1 Sales approval lifecycle');
console.log('Before approval: runtime stopped in review and no Gmail draft was created.');
console.log('Approval actor: human_executive');
console.log(`After approval: ${completed.record.task.status}`);
console.log(`Provider: ${completed.record.result.output.provider}`);
console.log(`Mode: ${completed.record.result.output.mode}`);
console.log(`Draft ID: ${completed.record.result.output.draftId}`);
console.log(`Audit events: ${events.length}`);
console.log('No email was sent. No client or prospect data was used.');
console.log('Open Gmail Drafts and confirm the Stage 1 approved AxorOS TEST draft is present.');
