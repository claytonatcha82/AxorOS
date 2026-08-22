import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsProductionPrerequisiteRecorder } from './operations-production-prerequisite-recorder.js';

function recorderHarness() {
  const inputs: unknown[] = [];
  const recorder = createOperationsProductionPrerequisiteRecorder({
    async record(input) {
      inputs.push(input);
      return {
        id: `workflow-event:${inputs.length}`,
        clientId: null,
        projectId: null,
        eventType: input.eventType,
        actorType: 'agent',
        actorId: 'operations_agent',
        payload: {
          commercialRecordReference: input.commercialRecordReference,
          verified: true,
          evidenceReference: input.evidenceReference,
          observedAt: input.observedAt,
        },
        createdAt: '2026-08-22T11:15:00.000Z',
      };
    },
  });
  return { recorder, inputs };
}

test('Operations prerequisite recorder fixes event type and normalizes authoritative evidence identity', async () => {
  const { recorder, inputs } = recorderHarness();
  const event = await recorder.record({
    commercialRecordReference: ' commercial:test:1 ',
    prerequisite: 'contractSigned',
    evidenceReference: ' contract-provider:test:1 ',
    observedAt: '2026-08-22T11:00:00+02:00',
  });

  assert.equal(event.eventType, 'operations_contract_signed_verified');
  assert.equal(event.actorType, 'agent');
  assert.equal(event.actorId, 'operations_agent');
  assert.deepEqual(inputs[0], {
    eventType: 'operations_contract_signed_verified',
    commercialRecordReference: 'commercial:test:1',
    evidenceReference: 'contract-provider:test:1',
    observedAt: '2026-08-22T09:00:00.000Z',
  });
});

test('Operations prerequisite recorder rejects invalid identity, evidence, prerequisite, and timestamp', async () => {
  const { recorder } = recorderHarness();
  const base = {
    commercialRecordReference: 'commercial:test:1',
    prerequisite: 'contractSigned' as const,
    evidenceReference: 'contract:test:1',
    observedAt: '2026-08-22T11:00:00.000Z',
  };

  await assert.rejects(() => recorder.record({ ...base, commercialRecordReference: ' ' }), /commercial record is required/);
  await assert.rejects(() => recorder.record({ ...base, evidenceReference: ' ' }), /evidence reference is required/);
  await assert.rejects(() => recorder.record({ ...base, prerequisite: 'notAllowed' as never }), /prerequisite is invalid/);
  await assert.rejects(() => recorder.record({ ...base, observedAt: 'invalid' }), /timestamp is invalid/);
});
