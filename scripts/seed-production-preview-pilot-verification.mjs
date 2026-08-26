import { Pool } from 'pg';
import { FinanceClearancePostgresStore } from '../apps/api/dist/data/finance-clearance-postgres-store.js';
import { FinancePaymentCurrentStatePostgresStore } from '../apps/api/dist/data/finance-payment-current-state-postgres-store.js';
import { CommercialPaymentRequirementPostgresStore } from '../apps/api/dist/data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../apps/api/dist/data/commercial-payment-satisfaction-postgres-store.js';
import { OperationsProductionReadinessPostgresStore } from '../apps/api/dist/data/operations-production-readiness-postgres-store.js';
import { satisfyCommercialPaymentRequirement } from '../apps/api/dist/agents/finance-commercial-payment-requirement.js';

const databaseUrl = process.env.AXOROS_DATABASE_URL;
if (!databaseUrl) throw new Error('AXOROS_DATABASE_URL is required.');

const commercialRecordReference = 'pilot-preview-verification';
const clearanceId = 'finance-clearance:pilot-preview-verification';
const readinessId = 'operations-readiness:pilot-preview-verification';
const provider = 'verification';
const providerPaymentReference = 'payment:pilot-preview-verification';
const requirementReference = 'payment-requirement:pilot-preview-verification';
const amountMinor = 100;
const currency = 'ZAR';
const occurredAt = '2026-08-25T20:00:00.000Z';

const pool = new Pool({ connectionString: databaseUrl });

try {
  const clearanceStore = new FinanceClearancePostgresStore(pool);
  const paymentStateStore = new FinancePaymentCurrentStatePostgresStore(pool);
  const requirementStore = new CommercialPaymentRequirementPostgresStore(pool);
  const satisfactionStore = new CommercialPaymentSatisfactionPostgresStore(pool);
  const readinessStore = new OperationsProductionReadinessPostgresStore(pool);

  await requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: amountMinor,
    currency,
    status: 'ACTIVE',
  });

  await paymentStateStore.apply({
    provider,
    providerEventReference: 'event:pilot-preview-verification',
    providerPaymentReference,
    commercialRecordReference,
    eventType: 'payment_paid',
    evidenceReference: 'verification:pilot-preview-payment-paid',
    occurredAt,
    amountMinor,
    currency,
  });

  await clearanceStore.save({
    clearanceId,
    commercialRecordReference,
    providerPaymentReference,
    state: 'FINANCE_CLEARED',
    reason: 'Dev-only pilot preview verification fixture.',
    evidenceReferences: [`payment-provider:${provider}:pilot-preview-verification`],
    amountMinor,
    currency,
    verifiedAt: occurredAt,
  });

  await satisfyCommercialPaymentRequirement({ requirementStore, satisfactionStore, clearanceStore }, {
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    clearanceId,
  });

  await readinessStore.save({
    readinessId,
    commercialRecordReference,
    state: 'OPERATIONS_READY',
    contractSigned: true,
    onboardingComplete: true,
    assetsAvailable: true,
    planningComplete: true,
    evidenceReferences: ['verification:pilot-preview-operations-ready'],
    approvedBy: 'human_executive:pilot-verification',
    approvedAt: occurredAt,
  });

  console.log('PASS  Pilot preview verification authority set persisted through governed stores.');
  console.log(`commercialRecordReference=${commercialRecordReference}`);
  console.log(`financeClearanceId=${clearanceId}`);
  console.log(`operationsReadinessId=${readinessId}`);
} finally {
  await pool.end();
}
