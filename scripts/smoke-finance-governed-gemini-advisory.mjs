import assert from 'node:assert/strict';
import pg from 'pg';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { createFinanceGovernedAdvisoryService } from '../apps/api/dist/agents/finance-governed-advisory-service.js';

const { Pool } = pg;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
};

const connectionString = required('AXOROS_DATABASE_URL');
const geminiApiKey = required('GEMINI_API_KEY');
const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  geminiApiKey,
  ...(process.env.AXOROS_GEMINI_MODEL?.trim() ? { geminiModel: process.env.AXOROS_GEMINI_MODEL.trim() } : {}),
});
if (!registeredIntegrationIds.includes('model.gemini')) throw new Error('Gemini integration is not registered.');

const pool = new Pool({ connectionString, max: 2, application_name: 'axoros-finance-governed-gemini-advisory-smoke' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:finance-governed-gemini:${suffix}`;
const gate = 'PRODUCTION_START';
const requirementReference = `deposit:${commercialRecordReference}`;
const provider = 'paystack';
const providerPaymentReference = `synthetic-unverified:${suffix}`;
const executionId = `exec:finance-governed-gemini:${suffix}`;
const correlationId = `corr:finance-governed-gemini:${suffix}`;
let auditEventId;

try {
  const financeRuntime = createFinancePaymentRuntime({ pool, integrations: registry });
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
  auditEventId = assessed.auditEventReference.replace('workflow-event:', '');
  assert.equal(assessed.decision.state, 'AWAITING_VERIFIED_PAYMENT');
  assert.equal(assessed.decision.clearanceId, undefined);
  assert.equal(assessed.decision.paymentEvidenceReference, undefined);

  const advisoryService = createFinanceGovernedAdvisoryService({ integrations: registry });
  const advisory = await advisoryService.advise({
    executionId,
    correlationId,
    decision: assessed.decision,
  });

  assert.equal(advisory.decision, assessed.decision);
  assert.equal(typeof advisory.advisoryText, 'string');
  assert.ok(advisory.advisoryText.trim().length > 0);

  const clearance = await pool.query(
    'select clearance_id from finance.clearance_decisions where commercial_record_reference = $1',
    [commercialRecordReference],
  );
  const satisfaction = await financeRuntime.satisfactionStore.get(requirementReference);
  assert.equal(clearance.rowCount, 0);
  assert.equal(satisfaction, null);

  console.log('PASS live governed Finance assessment -> Gemini advisory');
  console.log(`Deterministic state: ${assessed.decision.state}`);
  console.log(`Model provider: ${advisory.provider}`);
  console.log(`Model: ${advisory.model}`);
  console.log(`Audit evidence: ${assessed.auditEventReference}`);
  console.log('Gemini consumed authoritative Finance context but created no clearance, satisfaction, payment evidence, email, or money movement.');
  console.log('Synthetic data only.');
} finally {
  if (auditEventId) {
    await pool.query('delete from operational.workflow_events where id::text = $1', [auditEventId]).catch(() => undefined);
  }
  await pool.query('delete from finance.commercial_payment_satisfactions where requirement_reference = $1', [requirementReference]).catch(() => undefined);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1', [commercialRecordReference]).catch(() => undefined);
  await pool.query('delete from finance.clearance_decisions where commercial_record_reference = $1', [commercialRecordReference]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
