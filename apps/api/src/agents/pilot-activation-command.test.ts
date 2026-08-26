import assert from 'node:assert/strict';
import test from 'node:test';
import { createPilotActivationCommand } from './pilot-activation-command.js';
import type { PilotActivationReadinessRecord } from '../data/pilot-activation-readiness-postgres-store.js';
import type { PilotSystemStateRecord } from '../data/pilot-system-state-postgres-store.js';

const now = '2026-08-26T14:30:00.000Z';

function ready(overrides: Partial<PilotActivationReadinessRecord> = {}): PilotActivationReadinessRecord {
  return {
    readinessId: 'pilot-readiness:test:1',
    state: 'PILOT_ACTIVATION_READY',
    syntheticLifecycleVerified: true,
    persistedRuntimeVerified: true,
    financeIntegrityVerified: true,
    controlPlaneVerified: true,
    deploymentSafetyVerified: true,
    evidenceReferences: [
      'stage1:synthetic:lifecycle',
      'runtime:persistence:verified',
      'finance:integrity:verified',
      'control-plane:approval:verified',
      'deployment:pilot-boundary:verified',
    ],
    assessedBy: 'operations_agent',
    assessedAt: now,
    ...overrides,
  };
}

function disabled(): PilotSystemStateRecord {
  return {
    state: 'PILOT_DISABLED',
    changedBy: 'system',
    reason: 'Fail closed.',
    version: 1,
    changedAt: now,
  };
}

test('Human Executive activates pilot only from persisted ready evidence', async () => {
  let state = disabled();
  let setCalls = 0;
  const command = createPilotActivationCommand({
    readinessStore: { async get() { return ready(); } },
    pilotStateStore: {
      async get() { return state; },
      async set(nextState, changedBy, reason) {
        setCalls += 1;
        state = {
          state: nextState,
          changedBy,
          reason,
          version: state.version + 1,
          changedAt: now,
        };
        return state;
      },
    },
  });

  const result = await command.activate({
    readinessId: 'pilot-readiness:test:1',
    actor: 'human_executive',
    reason: 'Controlled pilot activation approved.',
  });

  assert.equal(result.state.state, 'PILOT_ACTIVE');
  assert.equal(result.state.changedBy, 'human_executive');
  assert.match(result.state.reason, /pilot-readiness:test:1/);
  assert.equal(result.replayed, false);
  assert.equal(setCalls, 1);
});

test('blocked readiness cannot activate pilot', async () => {
  let setCalls = 0;
  const command = createPilotActivationCommand({
    readinessStore: {
      async get() {
        return ready({
          state: 'PILOT_ACTIVATION_BLOCKED',
          deploymentSafetyVerified: false,
        });
      },
    },
    pilotStateStore: {
      async get() { return disabled(); },
      async set() {
        setCalls += 1;
        throw new Error('must not mutate');
      },
    },
  });

  await assert.rejects(
    command.activate({
      readinessId: 'pilot-readiness:test:1',
      actor: 'human_executive',
      reason: 'Attempt activation.',
    }),
    /PILOT_ACTIVATION_BLOCKED/,
  );
  assert.equal(setCalls, 0);
});

test('ready label with a missing system gate fails closed', async () => {
  const command = createPilotActivationCommand({
    readinessStore: {
      async get() {
        return ready({ financeIntegrityVerified: false });
      },
    },
    pilotStateStore: {
      async get() { return disabled(); },
      async set() { throw new Error('must not mutate'); },
    },
  });

  await assert.rejects(
    command.activate({
      readinessId: 'pilot-readiness:test:1',
      actor: 'human_executive',
      reason: 'Attempt activation.',
    }),
    /missing one or more required system verification gates/,
  );
});

test('activation is idempotent when pilot is already active', async () => {
  let setCalls = 0;
  const active: PilotSystemStateRecord = {
    state: 'PILOT_ACTIVE',
    changedBy: 'human_executive',
    reason: 'Already active.',
    version: 2,
    changedAt: now,
  };
  const command = createPilotActivationCommand({
    readinessStore: { async get() { return ready(); } },
    pilotStateStore: {
      async get() { return active; },
      async set() {
        setCalls += 1;
        throw new Error('must not mutate');
      },
    },
  });

  const result = await command.activate({
    readinessId: 'pilot-readiness:test:1',
    actor: 'human_executive',
    reason: 'Replay activation.',
  });
  assert.equal(result.replayed, true);
  assert.equal(result.state.version, 2);
  assert.equal(setCalls, 0);
});
