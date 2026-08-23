import assert from 'node:assert/strict';
import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { createFinanceGovernedCommunicationDraftService } from '../apps/api/dist/agents/finance-governed-communication-draft-service.js';
import { createFinanceGovernedEmailPreparationService } from '../apps/api/dist/agents/finance-governed-email-preparation-service.js';
import { registerFinanceEmailCapabilities, FINANCE_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/finance-email-capabilities.js';
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
try {
  identityAddresses = JSON.parse(identitiesJson);
} catch {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.');
}
const financeAddress = typeof identityAddresses?.finance === 'string' ? identityAddresses.finance.trim() : '';
if (!financeAddress) throw new Error('A finance Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  geminiApiKey,
  ...(process.env.AXOROS_GEMINI_MODEL?.trim() ? { geminiModel: process.env.AXOROS_GEMINI_MODEL.trim() } : {}),
  gmailClientId,
  gmailClientSecret,
  gmailRefreshToken,
  gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('model.gemini') || !registeredIntegrationIds.includes('email.gmail')) {
  throw new Error('Gemini and Gmail integrations must both be registered.');
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-governed-gemini-gmail-workflow',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'paystack';
const commercialRecordReference = `commercial:finance-governed-communication:${suffix}`;
const providerPaymentReference = `payment:finance-governed-communication:${suffix}`;
const requirementReference = `deposit:${commercialRecordReference}`;
const gate = 'PRODUCTION_START';
const emailExecutionId = `finance-governed-email-${suffix}`;
const correlationId = `corr:finance-governed-email-${suffix}`;
let auditEventId;

const financeRuntime = createFinancePaymentRuntime({ pool, integrations: registry });
const communicationDraftService = createFinanceGovernedCommunicationDraftService({ integrations: registry });
const emailPreparationService = createFinanceGovernedEmailPreparationService({ communicationDraftService });
const runtimeStore = createAgentRuntimePostgresStore(pool);
const handlers = new AgentRuntimeHandlerRegistry();
registerFinanceEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });
const orchestrator = createAgentRuntimeOrchestrator({ store: runtimeStore, handlers });

async function cleanup() {
  await pool.query('delete from runtime.agent_events where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from runtime.idempotency_records where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from runtime.agent_executions where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  if (auditEventId) {
    await pool.query('delete from operational.workflow_events where id = $1', [auditEventId]).catch(() => undefined);
  }
  await pool.query('delete from finance.commercial_payment_satisfactions where requirement_reference = $1', [requirementReference]).catch(() => undefined);
  await pool.query('delete from finance.payment_current_state where provider = $1 and provider_payment_reference = $2', [provider, providerPaymentReference]).catch(() => undefined);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1 and gate = $2', [commercialRecordReference, gate]).catch(() => undefined);
}

try {
  await financeRuntime.requirementStore.save({
    commercialRecordReference,
    gate,
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 10000,
    currency: 'ZAR',
    status: 'ACTIVE',
  });

  const assessed = await financeRuntime.governedOperationalRuntime.assess({
    commercialRecordReference,
    gate,
    provider,
    providerPaymentReference,
  });
  assert.equal(assessed.decision.state, 'AWAITING_VERIFIED_PAYMENT');
  assert.equal(assessed.decision.clearanceId, undefined);
  assert.equal(assessed.decision.paymentEvidenceReference, undefined);
  assert.equal(assessed.auditEventReference.startsWith('workflow-event:'), true);
  auditEventId = assessed.auditEventReference.slice('workflow-event:'.length);

  const persistedAssessment = await pool.query(
    `select event_type, actor_type, actor_id, payload
       from operational.workflow_events
      where id = $1`,
    [auditEventId],
  );
  assert.ok(persistedAssessment.rows[0]);
  assert.equal(persistedAssessment.rows[0].event_type, 'finance_operational_assessment');
  assert.equal(persistedAssessment.rows[0].actor_id, 'finance_agent');
  assert.equal(persistedAssessment.rows[0].payload.state, 'AWAITING_VERIFIED_PAYMENT');

  const emailTask = await emailPreparationService.prepare({
    executionId: emailExecutionId,
    correlationId,
    decision: assessed.decision,
    to: [{ email: financeAddress }],
    subject: '[AxorOS TEST] Governed Finance verification draft - DO NOT SEND',
  });
  assert.equal(emailTask.approvalRequired, true);
  assert.equal(emailTask.approvalOwner, 'human_executive');
  assert.equal(emailTask.status, 'ready');
  assert.equal(emailTask.context.financeGovernedCommunication?.sendAuthorised, false);
  assert.equal(emailTask.context.financeGovernedCommunication?.operationalState, 'AWAITING_VERIFIED_PAYMENT');
  assert.equal(emailTask.context.financeGovernedCommunication?.intent, 'DRAFT_PAYMENT_VERIFICATION_REQUEST');

  await runtimeStore.saveExecution({ task: emailTask, version: 1, persistedAt: emailTask.createdAt }, 0);

  const beforeApproval = await orchestrator.execute({
    executionId: emailExecutionId,
    capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY,
  });
  assert.equal(beforeApproval.record.task.status, 'review');
  assert.equal(beforeApproval.record.task.approvalOwner, 'human_executive');
  assert.equal(beforeApproval.record.result?.output?.draftId, undefined);

  const beforeApprovalEvents = await runtimeStore.listEvents(emailExecutionId);
  assert.equal(beforeApprovalEvents.some((event) => event.type === 'approval_requested'), true);
  assert.equal(beforeApprovalEvents.some((event) => event.type === 'approval_granted'), false);

  const approved = await orchestrator.resolveApproval({
    executionId: emailExecutionId,
    actor: 'human_executive',
    decision: 'approved',
    reason: 'Controlled synthetic governed Finance communication smoke approved for Gmail draft creation only.',
  });
  assert.equal(approved.record.task.status, 'ready');
  assert.equal(approved.record.task.approvalRequired, false);

  const emailOutcome = await orchestrator.execute({
    executionId: emailExecutionId,
    capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY,
  });
  assert.equal(emailOutcome.record.task.status, 'completed');
  assert.equal(emailOutcome.record.result?.status, 'completed');
  assert.equal(emailOutcome.record.result?.output?.integrationId, 'email.gmail');
  assert.equal(emailOutcome.record.result?.output?.mode, 'draft');
  assert.ok(emailOutcome.record.result?.output?.draftId);

  const finalEvents = await runtimeStore.listEvents(emailExecutionId);
  assert.equal(finalEvents.some((event) => event.type === 'approval_requested'), true);
  assert.equal(finalEvents.some((event) => event.type === 'approval_granted'), true);

  const satisfaction = await financeRuntime.satisfactionStore.get(requirementReference);
  assert.equal(satisfaction, null);

  console.log('PASS governed persisted Finance state -> Gemini communication policy -> Human Executive approval -> Gmail draft-only workflow');
  console.log(`Deterministic state: ${assessed.decision.state}`);
  console.log(`Audit evidence: ${assessed.auditEventReference}`);
  console.log(`Draft ID: ${emailOutcome.record.result.output.draftId}`);
  console.log('No Gmail draft existed before Human Executive approval.');
  console.log('No email was sent. No Finance clearance or commercial payment satisfaction was created.');
  console.log('Synthetic data only. Open Gmail Drafts and review the AxorOS TEST Finance draft. Do not send it.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await pool.end().catch(() => undefined);
}
