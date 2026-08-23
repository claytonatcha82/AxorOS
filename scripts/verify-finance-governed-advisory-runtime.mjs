import assert from 'node:assert/strict';
import pg from 'pg';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { createFinanceGovernedAdvisoryService } from '../apps/api/dist/agents/finance-governed-advisory-service.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL?.trim();
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-governed-advisory-runtime-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'finance-governed-runtime-verifier';
const commercialRecordReference = `commercial:finance-governed-runtime:${suffix}`;
const providerPaymentReference = `payment:finance-governed-runtime:${suffix}`;
const providerEventReference = `event-paid:${suffix}`;
const paymentEvidenceReference = `payment-provider:${provider}:${providerEventReference}`;
const requirementReference = `deposit:${commercialRecordReference}`;
const gate = 'PRODUCTION_START';
const occurredAt = new Date().toISOString();
let modelCalls = 0;
let auditEventId;

const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'model.gemini',
  kind: 'model',
  provider: 'deterministic-finance-governed-advisory-verifier',
  supportedModes: ['draft'],
  supportedOperations: ['generate_text'],
  async execute(request) {
    modelCalls += 1;
    const context = String(request.input?.context ?? '');
    assert.equal(context.includes('AUTHORITATIVE DETERMINISTIC FINANCE ASSESSMENT'), true);
    assert.equal(context.includes('READY_TO_BIND_REQUIREMENT'), true);
    return {
      integrationId: 'model.gemini',
      operation: request.operation,
      provider: 'deterministic-finance-governed-advisory-verifier',
      mode: request.mode,
      status: 'drafted',
      output: {
        text: 'Advisory only: verified payment evidence is present; continue through the governed commercial-payment binding workflow.',
        model: 'deterministic-finance-verifier',
        finishReason: 'stop',
      },
      evidenceReferences: [`model:finance-governed-advisory:${suffix}:${modelCalls}`],
      retryable: false,
    };
  },
});

const runtime = createFinancePaymentRuntime({ pool, integrations });
const advisoryService = createFinanceGovernedAdvisoryService({ integrations });

async function cleanup() {
  if (auditEventId) {
    await pool.query('delete from operational.workflow_events where id = $1', [auditEventId]);
  }
  await pool.query(
    'delete from finance.commercial_payment_satisfactions where requirement_reference = $1',
    [requirementReference],
  );
  await pool.query(
    'delete from finance.payment_current_state where provider = $1 and provider_payment_reference = $2',
    [provider, providerPaymentReference],
  );
  await pool.query(
    'delete from finance.commercial_payment_requirements where commercial_record_reference = $1 and gate = $2',
    [commercialRecordReference, gate],
  );
}

try {
  await runtime.requirementStore.save({
    commercialRecordReference,
    gate,
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 10000,
    currency: 'ZAR',
    status: 'ACTIVE',
  });

  const paymentApply = await runtime.currentStateStore.apply({
    idempotencyKey: `payment-webhook:${provider}:${providerEventReference}`,
    provider,
    providerEventReference,
    providerPaymentReference,
    eventType: 'payment_paid',
    commercialRecordReference,
    amountMinor: 10000,
    currency: 'ZAR',
    occurredAt,
    evidenceReference: paymentEvidenceReference,
  });
  assert.equal(paymentApply, 'accepted');

  const assessed = await runtime.governedOperationalRuntime.assess({
    commercialRecordReference,
    gate,
    provider,
    providerPaymentReference,
  });
  assert.equal(assessed.decision.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(assessed.decision.paymentStatus, 'CONFIRMED');
  assert.equal(assessed.decision.authorityState, 'AUTHORIZED');
  assert.equal(assessed.decision.paymentEvidenceReference, paymentEvidenceReference);
  assert.equal(assessed.decision.clearanceId, undefined);
  assert.equal(assessed.auditEventReference.startsWith('workflow-event:'), true);
  auditEventId = assessed.auditEventReference.slice('workflow-event:'.length);

  const persistedEvent = await pool.query(
    `select event_type, actor_type, actor_id, payload
       from operational.workflow_events
      where id = $1`,
    [auditEventId],
  );
  assert.ok(persistedEvent.rows[0]);
  assert.equal(persistedEvent.rows[0].event_type, 'finance_operational_assessment');
  assert.equal(persistedEvent.rows[0].actor_type, 'agent');
  assert.equal(persistedEvent.rows[0].actor_id, 'finance_agent');
  assert.equal(persistedEvent.rows[0].payload.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(persistedEvent.rows[0].payload.paymentEvidenceReference, paymentEvidenceReference);

  const advisory = await advisoryService.advise({
    executionId: `exec:finance-governed-advisory:${suffix}`,
    correlationId: `corr:finance-governed-advisory:${suffix}`,
    decision: assessed.decision,
  });

  assert.equal(advisory.decision, assessed.decision);
  assert.equal(advisory.decision.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(advisory.decision.clearanceId, undefined);
  assert.equal(advisory.advisoryText.startsWith('Advisory only:'), true);
  assert.equal(modelCalls, 1);

  const satisfaction = await runtime.satisfactionStore.get(requirementReference);
  assert.equal(satisfaction, null);

  console.log('PASS  Persisted Finance operational assessment remains authoritative while Gemini advisory consumes it without creating clearance, satisfaction, or financial authority.');
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
