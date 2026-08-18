import pg from 'pg';
import { CommercialPaymentRequirementPostgresStore } from '../apps/api/dist/data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../apps/api/dist/data/commercial-payment-satisfaction-postgres-store.js';
import { FinanceClearancePostgresStore } from '../apps/api/dist/data/finance-clearance-postgres-store.js';
import {
  assertCommercialPaymentGateSatisfied,
  satisfyCommercialPaymentRequirement,
} from '../apps/api/dist/agents/finance-commercial-payment-requirement.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-commercial-payment-satisfaction-verify',
});

const requirementStore = new CommercialPaymentRequirementPostgresStore(pool);
const satisfactionStore = new CommercialPaymentSatisfactionPostgresStore(pool);
const clearanceStore = new FinanceClearancePostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:payment-gates:${suffix}`;
const requirementReferences = [];
const clearanceIds = [];

const gateDefinitions = [
  { gate: 'PRODUCTION_START', requirementType: 'DEPOSIT', amountMinor: 10000, label: 'deposit' },
  { gate: 'MILESTONE_RELEASE', requirementType: 'MILESTONE', amountMinor: 20000, label: 'milestone' },
  { gate: 'FINAL_HANDOVER', requirementType: 'FINAL', amountMinor: 30000, label: 'final' },
];

function clearance(definition) {
  const clearanceId = `finance-clearance:payment-gates:${suffix}:${definition.label}`;
  clearanceIds.push(clearanceId);
  return {
    clearanceId,
    commercialRecordReference,
    providerPaymentReference: `pay:payment-gates:${suffix}:${definition.label}`,
    state: 'FINANCE_CLEARED',
    reason: `Live verifier ${definition.gate} payment matched.`,
    evidenceReferences: [`payment-provider:live-payment-gates:event:${suffix}:${definition.label}`],
    amountMinor: definition.amountMinor,
    currency: 'ZAR',
    verifiedAt: new Date(Date.now() + definition.amountMinor).toISOString(),
  };
}

async function cleanup() {
  if (requirementReferences.length > 0) {
    await pool.query(
      'delete from finance.commercial_payment_satisfactions where requirement_reference = any($1::text[])',
      [requirementReferences],
    );
  }
  if (clearanceIds.length > 0) {
    await pool.query('delete from finance.clearance_decisions where clearance_id = any($1::text[])', [clearanceIds]);
  }
  await pool.query(
    'delete from finance.commercial_payment_requirements where commercial_record_reference = $1',
    [commercialRecordReference],
  );
}

try {
  const clearances = new Map();

  for (const definition of gateDefinitions) {
    const requirementReference = `requirement:payment-gates:${suffix}:${definition.label}`;
    requirementReferences.push(requirementReference);
    const requirementPersistence = await requirementStore.save({
      commercialRecordReference,
      gate: definition.gate,
      requirementReference,
      requirementType: definition.requirementType,
      requiredAmountMinor: definition.amountMinor,
      currency: 'ZAR',
      status: 'ACTIVE',
    });
    if (requirementPersistence !== 'accepted') {
      throw new Error(`${definition.gate} requirement was not newly accepted.`);
    }

    const decision = clearance(definition);
    const clearancePersistence = await clearanceStore.save(decision);
    if (clearancePersistence !== 'accepted') {
      throw new Error(`${definition.gate} Finance clearance was not newly accepted.`);
    }
    clearances.set(definition.gate, decision);

    const satisfied = await satisfyCommercialPaymentRequirement({
      requirementStore,
      satisfactionStore,
      clearanceStore,
    }, {
      commercialRecordReference,
      gate: definition.gate,
      clearanceId: decision.clearanceId,
    });
    if (satisfied.persistence !== 'accepted') {
      throw new Error(`${definition.gate} satisfaction was not newly accepted.`);
    }

    await assertCommercialPaymentGateSatisfied({ requirementStore, satisfactionStore }, {
      commercialRecordReference,
      gate: definition.gate,
      clearanceId: decision.clearanceId,
    });

    const replay = await satisfyCommercialPaymentRequirement({
      requirementStore,
      satisfactionStore,
      clearanceStore,
    }, {
      commercialRecordReference,
      gate: definition.gate,
      clearanceId: decision.clearanceId,
    });
    if (replay.persistence !== 'duplicate') {
      throw new Error(`${definition.gate} exact satisfaction replay was not duplicate.`);
    }
  }

  const depositClearance = clearances.get('PRODUCTION_START');
  if (!depositClearance) throw new Error('deposit clearance fixture was not created.');

  let wrongGateBlocked = false;
  try {
    await assertCommercialPaymentGateSatisfied({ requirementStore, satisfactionStore }, {
      commercialRecordReference,
      gate: 'MILESTONE_RELEASE',
      clearanceId: depositClearance.clearanceId,
    });
  } catch (error) {
    wrongGateBlocked = error instanceof Error && error.message.includes('different Finance clearance');
  }
  if (!wrongGateBlocked) {
    throw new Error('PRODUCTION_START clearance was incorrectly accepted for MILESTONE_RELEASE.');
  }

  console.log('PASS  PRODUCTION_START, MILESTONE_RELEASE, and FINAL_HANDOVER each require their own immutable Finance-clearance satisfaction, exact replay is idempotent, and a deposit clearance cannot satisfy a later gate.');
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
