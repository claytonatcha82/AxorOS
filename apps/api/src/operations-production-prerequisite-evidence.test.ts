import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOperationsProductionPrerequisiteEvidenceResolver,
  OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES,
} from './agents/operations-production-prerequisite-evidence.js';

function poolWithRows(rows: Record<string, unknown>[]) {
  return {
    async query(sql: string, values?: unknown[]) {
      assert.match(sql, /operational\.workflow_events/);
      assert.deepEqual(values?.[0], Object.values(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES));
      assert.equal(values?.[1], 'commercial:test');
      return { rows };
    },
  };
}

test('resolves all four prerequisites from verified Operations workflow evidence', async () => {
  const rows = Object.entries(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES).map(([key, eventType], index) => ({
    id: `event-${index + 1}`,
    event_type: eventType,
    actor_type: 'agent',
    actor_id: 'operations_agent',
    payload: { commercialRecordReference: 'commercial:test', verified: true, key },
  }));
  const resolver = createOperationsProductionPrerequisiteEvidenceResolver({ pool: poolWithRows(rows) as never });
  const result = await resolver.resolve(' commercial:test ');
  assert.equal(result.contractSigned, true);
  assert.equal(result.onboardingComplete, true);
  assert.equal(result.assetsAvailable, true);
  assert.equal(result.planningComplete, true);
  assert.deepEqual(result.evidenceReferences, [
    'workflow-event:event-1',
    'workflow-event:event-2',
    'workflow-event:event-3',
    'workflow-event:event-4',
  ]);
});

test('ignores unverified, wrong-actor, and unrelated prerequisite events', async () => {
  const resolver = createOperationsProductionPrerequisiteEvidenceResolver({
    pool: poolWithRows([
      {
        id: 'contract-unverified',
        event_type: OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.contractSigned,
        actor_type: 'agent',
        actor_id: 'operations_agent',
        payload: { commercialRecordReference: 'commercial:test', verified: false },
      },
      {
        id: 'onboarding-wrong-actor',
        event_type: OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.onboardingComplete,
        actor_type: 'agent',
        actor_id: 'sales_agent',
        payload: { commercialRecordReference: 'commercial:test', verified: true },
      },
      {
        id: 'assets-good',
        event_type: OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.assetsAvailable,
        actor_type: 'agent',
        actor_id: 'operations_agent',
        payload: { commercialRecordReference: 'commercial:test', verified: true },
      },
      {
        id: 'planning-invalid-payload',
        event_type: OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES.planningComplete,
        actor_type: 'agent',
        actor_id: 'operations_agent',
        payload: null,
      },
    ]) as never,
  });
  const result = await resolver.resolve('commercial:test');
  assert.equal(result.contractSigned, false);
  assert.equal(result.onboardingComplete, false);
  assert.equal(result.assetsAvailable, true);
  assert.equal(result.planningComplete, false);
  assert.deepEqual(result.evidenceReferences, ['workflow-event:assets-good']);
});

test('fails closed on a blank commercial record reference', async () => {
  const resolver = createOperationsProductionPrerequisiteEvidenceResolver({ pool: poolWithRows([]) as never });
  await assert.rejects(() => resolver.resolve('   '), /commercial record is required/);
});
