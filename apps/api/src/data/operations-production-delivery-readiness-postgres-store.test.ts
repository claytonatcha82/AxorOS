import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperationsProductionDeliveryReadinessIntegrityConflictError,
  OperationsProductionDeliveryReadinessPostgresStore,
  type OperationsProductionDeliveryReadinessDecision,
} from './operations-production-delivery-readiness-postgres-store.js';

const decision: OperationsProductionDeliveryReadinessDecision = {
  readinessId: 'delivery-ready:commercial-1',
  commercialRecordReference: 'commercial-1',
  state: 'DELIVERY_READY',
  internalQaPassed: true,
  clientApproved: true,
  paymentConditionSatisfied: true,
  rollbackPrepared: true,
  seoChecked: true,
  securityChecked: true,
  deploymentApproved: true,
  evidenceReferences: ['qa:run-1', 'client-approval:1', 'security:scan-1'],
  approvedBy: 'human_executive',
  approvedAt: '2026-08-25T17:30:00.000Z',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    readiness_id: decision.readinessId,
    commercial_record_reference: decision.commercialRecordReference,
    state: decision.state,
    internal_qa_passed: true,
    client_approved: true,
    payment_condition_satisfied: true,
    rollback_prepared: true,
    seo_checked: true,
    security_checked: true,
    deployment_approved: true,
    evidence_references: decision.evidenceReferences,
    approved_by: decision.approvedBy,
    approved_at: new Date(decision.approvedAt),
    ...overrides,
  };
}

test('delivery readiness accepts and reloads the exact immutable decision', async () => {
  let inserted = false;
  const store = new OperationsProductionDeliveryReadinessPostgresStore({
    async query(sql: string) {
      if (sql.includes('insert into operations.production_delivery_readiness_decisions')) {
        inserted = true;
        return { rows: [], rowCount: 1 } as never;
      }
      if (sql.includes('from operations.production_delivery_readiness_decisions')) {
        return { rows: [row()], rowCount: 1 } as never;
      }
      throw new Error(`unexpected test SQL: ${sql}`);
    },
  });

  assert.equal(await store.save(decision), 'accepted');
  assert.equal(inserted, true);
  assert.deepEqual(await store.get(decision.readinessId), decision);
});

test('DELIVERY_READY fails closed unless every deployment gate is satisfied', async () => {
  const store = new OperationsProductionDeliveryReadinessPostgresStore({
    async query() { throw new Error('database must not be called'); },
  });

  await assert.rejects(
    () => store.save({ ...decision, securityChecked: false }),
    /DELIVERY_READY requires QA, client approval, payment condition, rollback, SEO, security, and deployment approval/,
  );
});

test('reusing a readiness ID with different persisted evidence is an integrity conflict', async () => {
  const store = new OperationsProductionDeliveryReadinessPostgresStore({
    async query(sql: string) {
      if (sql.includes('insert into operations.production_delivery_readiness_decisions')) {
        return { rows: [], rowCount: 0 } as never;
      }
      if (sql.includes('from operations.production_delivery_readiness_decisions')) {
        return { rows: [row({ evidence_references: ['different:evidence'] })], rowCount: 1 } as never;
      }
      throw new Error(`unexpected test SQL: ${sql}`);
    },
  });

  await assert.rejects(
    () => store.save(decision),
    OperationsProductionDeliveryReadinessIntegrityConflictError,
  );
});
