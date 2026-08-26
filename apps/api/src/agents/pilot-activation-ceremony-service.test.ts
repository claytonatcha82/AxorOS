import assert from 'node:assert/strict';
import test from 'node:test';
import { createPilotActivationCeremonyService } from './pilot-activation-ceremony-service.js';

const evidence = ['SYNTHETIC_LIFECYCLE','PERSISTED_RUNTIME','FINANCE_INTEGRITY','CONTROL_PLANE','DEPLOYMENT_SAFETY'].map((category, index) => ({
  evidenceId: `evidence:${index}`,
  category,
  outcome: 'PASS',
  verifier: 'test',
  sourceReference: `test://${index}`,
  details: {},
  verifiedAt: '2026-08-26T17:30:00.000Z',
}));
const readiness = {
  readinessId: 'readiness:test',
  state: 'PILOT_ACTIVATION_READY',
  syntheticLifecycleVerified: true,
  persistedRuntimeVerified: true,
  financeIntegrityVerified: true,
  controlPlaneVerified: true,
  deploymentSafetyVerified: true,
  evidenceReferences: evidence.map((item) => `pilot-verification:${item.evidenceId}`),
  assessedBy: 'test',
  assessedAt: '2026-08-26T17:31:00.000Z',
};

test('ceremony requires exact confirmations and audits preview/activation/deactivation', async () => {
  let state = { state: 'PILOT_DISABLED', changedBy: 'test', reason: 'test', version: 1, changedAt: '2026-08-26T17:31:00.000Z' };
  const audits: string[] = [];
  const service = createPilotActivationCeremonyService({
    readinessStore: { async get(id) { return id === readiness.readinessId ? readiness as never : null; } },
    evidenceStore: { async get(id) { return evidence.find((item) => item.evidenceId === id) as never ?? null; } },
    pilotStateStore: {
      async get() { return state as never; },
      async set(next, changedBy, reason) { state = { state: next, changedBy, reason, version: state.version + 1, changedAt: '2026-08-26T17:32:00.000Z' }; return state as never; },
    },
    activationCommand: {
      async activate() { state = { state: 'PILOT_ACTIVE', changedBy: 'human_executive', reason: 'approved', version: state.version + 1, changedAt: '2026-08-26T17:32:00.000Z' }; return { readinessId: readiness.readinessId, state: state as never, replayed: false }; },
    },
    auditStore: { async save(record) { audits.push(record.action); return 'accepted'; } },
  });

  const preview = await service.preview(readiness.readinessId);
  assert.equal(preview.evidence.length, 5);
  await assert.rejects(service.activate({ readinessId: readiness.readinessId, reason: 'go', confirmation: 'activate pilot' }), /exact confirmation ACTIVATE PILOT/);
  await service.activate({ readinessId: readiness.readinessId, reason: 'go', confirmation: 'ACTIVATE PILOT' });
  assert.equal(state.state, 'PILOT_ACTIVE');
  await service.deactivate({ readinessId: readiness.readinessId, reason: 'stop', confirmation: 'DISABLE PILOT' });
  assert.equal(state.state, 'PILOT_DISABLED');
  assert.deepEqual(audits, ['PREVIEWED','ACTIVATION_APPROVED','DEACTIVATION_PROVED']);
});
