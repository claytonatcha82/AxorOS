import type { PilotActivationReadinessRecord } from '../data/pilot-activation-readiness-postgres-store.js';
import type { PilotSystemStateRecord } from '../data/pilot-system-state-postgres-store.js';

export interface PilotActivationCommandDependencies {
  readinessStore: {
    get(readinessId: string): Promise<PilotActivationReadinessRecord | null>;
  };
  pilotStateStore: {
    get(): Promise<PilotSystemStateRecord>;
    set(state: 'PILOT_ACTIVE', changedBy: string, reason: string): Promise<PilotSystemStateRecord>;
  };
}

export interface PilotActivationCommandInput {
  readinessId: string;
  actor: 'human_executive';
  reason: string;
}

export interface PilotActivationCommandResult {
  readinessId: string;
  state: PilotSystemStateRecord;
  replayed: boolean;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function assertActivationReady(record: PilotActivationReadinessRecord): void {
  if (record.state !== 'PILOT_ACTIVATION_READY') {
    throw new Error(`Pilot activation readiness ${record.readinessId} is ${record.state}.`);
  }
  if (!record.syntheticLifecycleVerified
    || !record.persistedRuntimeVerified
    || !record.financeIntegrityVerified
    || !record.controlPlaneVerified
    || !record.deploymentSafetyVerified) {
    throw new Error('Pilot activation readiness is missing one or more required system verification gates.');
  }
  if (!record.evidenceReferences.length || record.evidenceReferences.some((reference) => !reference.trim())) {
    throw new Error('Pilot activation readiness is missing valid evidence references.');
  }
}

export function createPilotActivationCommand(dependencies: PilotActivationCommandDependencies) {
  return {
    async activate(input: PilotActivationCommandInput): Promise<PilotActivationCommandResult> {
      const readinessId = required(input.readinessId, 'readinessId');
      const reason = required(input.reason, 'reason');
      if (input.actor !== 'human_executive') {
        throw new Error('Pilot activation may only be performed by the Human Executive.');
      }

      const readiness = await dependencies.readinessStore.get(readinessId);
      if (!readiness) throw new Error(`Pilot activation readiness ${readinessId} was not found.`);
      assertActivationReady(readiness);

      const current = await dependencies.pilotStateStore.get();
      if (current.state === 'PILOT_ACTIVE') {
        return { readinessId, state: current, replayed: true };
      }
      if (current.state !== 'PILOT_DISABLED') {
        throw new Error(`Pilot activation cannot transition from unexpected state ${current.state}.`);
      }

      const state = await dependencies.pilotStateStore.set(
        'PILOT_ACTIVE',
        input.actor,
        `${reason} Readiness: ${readinessId}.`,
      );
      if (state.state !== 'PILOT_ACTIVE') {
        throw new Error('Pilot activation state mutation did not produce PILOT_ACTIVE.');
      }
      return { readinessId, state, replayed: false };
    },
  };
}
