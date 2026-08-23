import pg from 'pg';
import { createPersistedProductionRuntime } from '../apps/api/dist/agents/production-persisted-runtime.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from '../apps/api/dist/agents/production-model-capabilities.js';
import { PRODUCTION_PROJECT_PLAN_CAPABILITY } from '../apps/api/dist/agents/production-project-plan-capability.js';
import { satisfyCommercialPaymentRequirement } from '../apps/api/dist/agents/finance-commercial-payment-requirement.js';
import { FinancePaymentCurrentStatePostgresStore } from '../apps/api/dist/data/finance-payment-current-state-postgres-store.js';
import { CommercialPaymentRequirementPostgresStore } from '../apps/api/dist/data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../apps/api/dist/data/commercial-payment-satisfaction-postgres-store.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) { console.error('FAIL  AXOROS_DATABASE_URL is not set.'); process.exit(1); }
const pool = new Pool({ connectionString, max: 3, application_name: 'axoros-production-start-authority-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'live-verifier';
const adverseCases = [
  { eventType: 'payment_disputed', paymentStatus: 'DISPUTED', authorityState: 'MANUAL_REVIEW' },
  { eventType: 'payment_chargeback', paymentStatus: 'CHARGEBACK', authorityState: 'BLOCKED' },
  { eventType: 'payment_reversed', paymentStatus: 'CANCELLED', authorityState: 'BLOCKED' },
  { eventType: 'payment_refunded', paymentStatus: 'REFUNDED', authorityState: 'BLOCKED' },
];
const clearanceIds = [], readinessIds = [], paymentReferences = [], commercialRecordReferences = [], requirementReferences = [], executionIds = [];
let modelCalls = 0;
const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'model.gemini', kind: 'model', provider: 'deterministic-live-verifier', supportedModes: ['draft'], supportedOperations: ['generate_text'],
  async execute(request) {
    modelCalls += 1;
    return { integrationId: 'model.gemini', operation: request.operation, provider: 'deterministic-live-verifier', mode: request.mode, status: 'drafted', output: { text: 'governed production verification draft', model: 'deterministic-live-verifier', finishReason: 'stop' }, evidenceReferences: [`model:production-start-authority:${suffix}:${modelCalls}`], retryable: false };
  },
});
const runtime = createPersistedProductionRuntime({ pool, integrations });
const paymentStateStore = new FinancePaymentCurrentStatePostgresStore(pool);
const paymentRequirementStore = new CommercialPaymentRequirementPostgresStore(pool);
const paymentSatisfactionStore = new CommercialPaymentSatisfactionPostgresStore(pool);

function evidence({ paymentReference, commercialRecordReference, eventType, eventReference, occurredAt }) {
  return { idempotencyKey: `payment-webhook:${provider}:${eventReference}`, provider, providerEventReference: eventReference, providerPaymentReference: paymentReference, eventType, commercialRecordReference, amountMinor: 10000, currency: 'ZAR', occurredAt, evidenceReference: `payment-provider:${provider}:${eventReference}` };
}
function clearance({ clearanceId, paymentReference, commercialRecordReference, paidEvidenceReference, verifiedAt }) {
  return { clearanceId, commercialRecordReference, providerPaymentReference: paymentReference, state: 'FINANCE_CLEARED', reason: 'Trusted live verifier payment evidence matched.', evidenceReferences: [paidEvidenceReference], amountMinor: 10000, currency: 'ZAR', verifiedAt };
}
function readiness({ readinessId, commercialRecordReference, approvedAt }) {
  return { readinessId, commercialRecordReference, state: 'OPERATIONS_READY', contractSigned: true, onboardingComplete: true, assetsAvailable: true, planningComplete: true, evidenceReferences: [`operations-readiness:production-start:${readinessId}`], approvedBy: 'operations_agent', approvedAt };
}
function record({ executionId, clearanceId, operationsReadinessId, commercialRecordReference, productionPlanExecutionId }) {
  const now = new Date().toISOString();
  const context = { financeClearanceId: clearanceId, commercialRecordReference };
  if (operationsReadinessId) context.operationsReadinessId = operationsReadinessId;
  if (productionPlanExecutionId) context.productionPlanExecutionId = productionPlanExecutionId;
  return { task: { taskId: `task:${executionId}`, executionId, originAgent: 'operations_agent', destinationAgent: 'production_agent', objective: 'Verify governed persisted Production start authority.', priority: 'normal', context, knowledgeReferences: [], inputs: { implementationBrief: 'Create a deterministic governed Production verification draft.' }, expectedOutput: 'Technical implementation draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1, correlationId: `corr:${executionId}`, createdAt: now, updatedAt: now }, version: 1, persistedAt: now };
}
function planRecord({ executionId, clearanceId, operationsReadinessId, commercialRecordReference }) {
  const now = new Date().toISOString();
  return { task: { taskId: `task:${executionId}`, executionId, originAgent: 'operations_agent', destinationAgent: 'production_agent', objective: 'Create governed Production project plan for persisted-runtime verification.', priority: 'normal', context: { financeClearanceId: clearanceId, commercialRecordReference, operationsReadinessId }, knowledgeReferences: ['atlas:verification:production-project-plan'], inputs: { projectPackage: 'Approved deterministic verification project package. Create a non-production implementation plan only.', atlasContext: 'Authoritative deterministic Atlas verification context. No external deployment or client side effects are authorized.' }, expectedOutput: 'Structured Production project plan', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1, correlationId: `corr:${executionId}`, createdAt: now, updatedAt: now }, version: 1, persistedAt: now };
}
async function executeCase(input) {
  executionIds.push(input.executionId);
  await runtime.store.saveExecution(record(input), 0);
  return runtime.orchestrator.execute({ executionId: input.executionId, capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY });
}
async function createGovernedPlan({ label, clearanceId, operationsReadinessId, commercialRecordReference }) {
  const executionId = `exec-production-authority:${suffix}:${label}:plan`;
  executionIds.push(executionId);
  await runtime.store.saveExecution(planRecord({ executionId, clearanceId, operationsReadinessId, commercialRecordReference }), 0);
  const outcome = await runtime.orchestrator.execute({ executionId, capabilityId: PRODUCTION_PROJECT_PLAN_CAPABILITY });
  if (outcome.record.task.status !== 'completed' || outcome.record.result?.status !== 'completed') throw new Error(`${label} governed Production plan did not complete.`);
  if (!Array.isArray(outcome.record.result?.evidenceReferences) || outcome.record.result.evidenceReferences.length === 0) throw new Error(`${label} governed Production plan did not persist provider evidence.`);
  return executionId;
}
async function createProductionRequirement(commercialRecordReference, requiredAmountMinor = 10000) {
  const requirementReference = `deposit:${commercialRecordReference}`; requirementReferences.push(requirementReference);
  const result = await paymentRequirementStore.save({ commercialRecordReference, gate: 'PRODUCTION_START', requirementReference, requirementType: 'DEPOSIT', requiredAmountMinor, currency: 'ZAR', status: 'ACTIVE' });
  if (result !== 'accepted') throw new Error('PRODUCTION_START requirement was not newly accepted.');
}
async function bindProductionRequirement(commercialRecordReference, clearanceId) {
  const result = await satisfyCommercialPaymentRequirement({ requirementStore: paymentRequirementStore, satisfactionStore: paymentSatisfactionStore, clearanceStore: runtime.financeClearanceStore }, { commercialRecordReference, gate: 'PRODUCTION_START', clearanceId });
  if (result.persistence !== 'accepted') throw new Error('PRODUCTION_START satisfaction was not newly accepted.');
}
async function persistReadiness(commercialRecordReference, label, approvedAt) {
  const readinessId = `operations-readiness:production-authority:${suffix}:${label}`; readinessIds.push(readinessId);
  const result = await runtime.operationsReadinessStore.save(readiness({ readinessId, commercialRecordReference, approvedAt }));
  if (result !== 'accepted') throw new Error(`${label} Operations readiness was not newly accepted.`);
  return readinessId;
}
async function verifyAdverseCase(definition, index) {
  const label = definition.eventType.replace('payment_', '');
  const commercialRecordReference = `commercial:production-authority:${suffix}:${label}`;
  const paymentReference = `pay-production-authority:${suffix}:${label}`;
  const clearanceId = `finance-clearance:production-authority:${suffix}:${label}`;
  const paidEventReference = `event-paid:${suffix}:${label}`;
  const adverseEventReference = `event-${label}:${suffix}:${label}`;
  const baseMs = Date.now() + index * 10000;
  const paidAt = new Date(baseMs).toISOString(), adverseAt = new Date(baseMs + 2000).toISOString(), stalePaidAt = new Date(baseMs + 1000).toISOString();
  const paidEvidenceReference = `payment-provider:${provider}:${paidEventReference}`;
  clearanceIds.push(clearanceId); paymentReferences.push(paymentReference); commercialRecordReferences.push(commercialRecordReference);
  await createProductionRequirement(commercialRecordReference);
  if (await runtime.financeClearanceStore.save(clearance({ clearanceId, paymentReference, commercialRecordReference, paidEvidenceReference, verifiedAt: paidAt })) !== 'accepted') throw new Error(`${label} clearance was not newly accepted.`);
  if (await paymentStateStore.apply(evidence({ paymentReference, commercialRecordReference, eventType: 'payment_paid', eventReference: paidEventReference, occurredAt: paidAt })) !== 'accepted') throw new Error(`${label} paid state was not accepted.`);
  await bindProductionRequirement(commercialRecordReference, clearanceId);

  const callsBeforeFinanceOnly = modelCalls;
  const financeOnly = await executeCase({ executionId: `exec-production-authority:${suffix}:${label}:finance-only`, clearanceId, commercialRecordReference });
  if (financeOnly.record.task.status !== 'failed' || !financeOnly.record.result?.errorMessage?.includes('operationsReadinessId')) throw new Error(`${label} Finance-only Production execution did not fail closed on missing Operations readiness.`);
  if (modelCalls !== callsBeforeFinanceOnly) throw new Error(`${label} Finance-only Production execution reached the model provider.`);

  const operationsReadinessId = await persistReadiness(commercialRecordReference, label, paidAt);
  const callsBeforePlan = modelCalls;
  const productionPlanExecutionId = await createGovernedPlan({ label, clearanceId, operationsReadinessId, commercialRecordReference });
  if (modelCalls !== callsBeforePlan + 1) throw new Error(`${label} governed Production planning did not reach the model exactly once.`);

  const callsBeforeAuthorized = modelCalls;
  const authorized = await executeCase({ executionId: `exec-production-authority:${suffix}:${label}:authorized`, clearanceId, operationsReadinessId, commercialRecordReference, productionPlanExecutionId });
  if (authorized.record.task.status !== 'completed' || authorized.record.result?.status !== 'completed') throw new Error(`${label} combined Finance + Operations + plan Production execution did not complete.`);
  if (modelCalls !== callsBeforeAuthorized + 1) throw new Error(`${label} authorized Production execution did not reach the model exactly once.`);

  if (await paymentStateStore.apply(evidence({ paymentReference, commercialRecordReference, eventType: definition.eventType, eventReference: adverseEventReference, occurredAt: adverseAt })) !== 'accepted') throw new Error(`${label} adverse payment state was not accepted.`);
  const current = await paymentStateStore.get(provider, paymentReference);
  if (!current) throw new Error(`${label} authoritative current payment state was not persisted.`);
  if (current.paymentStatus !== definition.paymentStatus || current.authorityState !== definition.authorityState) throw new Error(`${label} current state expected ${definition.authorityState}/${definition.paymentStatus} but received ${current.authorityState}/${current.paymentStatus}.`);

  const callsBeforeBlocked = modelCalls;
  const blocked = await executeCase({ executionId: `exec-production-authority:${suffix}:${label}:blocked`, clearanceId, operationsReadinessId, commercialRecordReference, productionPlanExecutionId });
  if (blocked.record.task.status !== 'failed' || blocked.record.result?.errorCode !== 'RUNTIME_HANDLER_FAILURE') throw new Error(`${label} revoked Production execution did not fail closed.`);
  if (modelCalls !== callsBeforeBlocked) throw new Error(`${label} revoked Production execution reached the model provider.`);

  if (await paymentStateStore.apply(evidence({ paymentReference, commercialRecordReference, eventType: 'payment_paid', eventReference: `event-stale-paid:${suffix}:${label}`, occurredAt: stalePaidAt })) !== 'stale') throw new Error(`${label} stale paid event was not rejected as stale.`);
  const afterStale = await paymentStateStore.get(provider, paymentReference);
  if (!afterStale || afterStale.paymentStatus !== definition.paymentStatus || afterStale.authorityState !== definition.authorityState) throw new Error(`${label} stale paid event changed authoritative payment state.`);
  const persistedClearance = await runtime.financeClearanceStore.get(clearanceId);
  if (!persistedClearance || persistedClearance.state !== 'FINANCE_CLEARED') throw new Error(`${label} immutable historical Finance clearance was modified.`);
  if (persistedClearance.evidenceReferences.length !== 1 || persistedClearance.evidenceReferences[0] !== paidEvidenceReference) throw new Error(`${label} immutable Finance clearance evidence was modified.`);
  const persistedReadiness = await runtime.operationsReadinessStore.get(operationsReadinessId);
  if (!persistedReadiness || persistedReadiness.state !== 'OPERATIONS_READY') throw new Error(`${label} immutable Operations readiness was modified.`);
}
async function verifyUnderfundedRequirementBlocks() {
  const commercialRecordReference = `commercial:production-authority:${suffix}:underfunded`, paymentReference = `pay-production-authority:${suffix}:underfunded`, clearanceId = `finance-clearance:production-authority:${suffix}:underfunded`, eventReference = `event-paid:${suffix}:underfunded`;
  const paidAt = new Date(Date.now() + 60000).toISOString(), paidEvidenceReference = `payment-provider:${provider}:${eventReference}`;
  clearanceIds.push(clearanceId); paymentReferences.push(paymentReference); commercialRecordReferences.push(commercialRecordReference);
  await createProductionRequirement(commercialRecordReference, 15000);
  await runtime.financeClearanceStore.save(clearance({ clearanceId, paymentReference, commercialRecordReference, paidEvidenceReference, verifiedAt: paidAt }));
  await paymentStateStore.apply(evidence({ paymentReference, commercialRecordReference, eventType: 'payment_paid', eventReference, occurredAt: paidAt }));
  const operationsReadinessId = await persistReadiness(commercialRecordReference, 'underfunded', paidAt);
  let bindingBlocked = false;
  try { await bindProductionRequirement(commercialRecordReference, clearanceId); } catch (error) { bindingBlocked = error instanceof Error && error.message.includes('amount does not satisfy'); }
  if (!bindingBlocked) throw new Error('underfunded Finance clearance was incorrectly bound to PRODUCTION_START.');
  const callsBefore = modelCalls;
  const blocked = await executeCase({ executionId: `exec-production-authority:${suffix}:underfunded`, clearanceId, operationsReadinessId, commercialRecordReference });
  if (blocked.record.task.status !== 'failed' || !blocked.record.result?.errorMessage?.includes('has not been satisfied')) throw new Error('unsatisfied underfunded PRODUCTION_START requirement did not fail closed.');
  if (modelCalls !== callsBefore) throw new Error('unsatisfied underfunded PRODUCTION_START requirement reached the model provider.');
}
async function cleanup() {
  if (executionIds.length > 0) { await pool.query('delete from runtime.idempotency_records where execution_id = any($1::text[])', [executionIds]); await pool.query('delete from runtime.agent_executions where execution_id = any($1::text[])', [executionIds]); }
  if (requirementReferences.length > 0) await pool.query('delete from finance.commercial_payment_satisfactions where requirement_reference = any($1::text[])', [requirementReferences]);
  if (readinessIds.length > 0) await pool.query('delete from operations.production_readiness_decisions where readiness_id = any($1::text[])', [readinessIds]);
  if (clearanceIds.length > 0) await pool.query('delete from finance.clearance_decisions where clearance_id = any($1::text[])', [clearanceIds]);
  if (paymentReferences.length > 0) await pool.query('delete from finance.payment_current_state where provider = $1 and provider_payment_reference = any($2::text[])', [provider, paymentReferences]);
  if (commercialRecordReferences.length > 0) await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = any($1::text[])', [commercialRecordReferences]);
}
try {
  for (const [index, definition] of adverseCases.entries()) await verifyAdverseCase(definition, index);
  await verifyUnderfundedRequirementBlocks();
  console.log('PASS  Production requires matching immutable Finance satisfaction, Operations readiness, and a governed persisted Production plan; it rejects underfunded binding and revokes implementation after adverse payment lifecycle events without rewriting historical evidence.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1;
} finally {
  await cleanup().catch((error) => { console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
  await pool.end().catch(() => undefined);
}
