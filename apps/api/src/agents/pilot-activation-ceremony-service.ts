import type { PilotActivationCommandInput, PilotActivationCommandResult } from './pilot-activation-command.js';
import type { PilotActivationReadinessRecord } from '../data/pilot-activation-readiness-postgres-store.js';
import type { PilotVerificationEvidenceRecord } from '../data/pilot-verification-evidence-postgres-store.js';
import type { PilotActivationCeremonyAuditRecord } from '../data/pilot-activation-ceremony-audit-postgres-store.js';
import type { PilotSystemStateRecord } from '../data/pilot-system-state-postgres-store.js';

const REQUIRED_CATEGORIES = new Set(['SYNTHETIC_LIFECYCLE','PERSISTED_RUNTIME','FINANCE_INTEGRITY','CONTROL_PLANE','DEPLOYMENT_SAFETY']);

export interface PilotActivationCeremonyDependencies {
  readinessStore: { get(readinessId: string): Promise<PilotActivationReadinessRecord | null> };
  evidenceStore: { get(evidenceId: string): Promise<PilotVerificationEvidenceRecord | null> };
  pilotStateStore: {
    get(): Promise<PilotSystemStateRecord>;
    set(state: 'PILOT_DISABLED', changedBy: string, reason: string): Promise<PilotSystemStateRecord>;
  };
  activationCommand: { activate(input: PilotActivationCommandInput): Promise<PilotActivationCommandResult> };
  auditStore: { save(record: PilotActivationCeremonyAuditRecord): Promise<'accepted' | 'replayed'> };
}

export interface PilotActivationCeremonyPreview {
  readiness: PilotActivationReadinessRecord;
  evidence: PilotVerificationEvidenceRecord[];
  pilotState: PilotSystemStateRecord;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function evidenceIdFromReference(reference: string): string {
  const prefix = 'pilot-verification:';
  if (!reference.startsWith(prefix)) throw new Error(`Invalid readiness evidence reference ${reference}.`);
  return reference.slice(prefix.length);
}

export function createPilotActivationCeremonyService(dependencies: PilotActivationCeremonyDependencies) {
  async function preview(readinessIdInput: string): Promise<PilotActivationCeremonyPreview> {
    const readinessId = required(readinessIdInput, 'readinessId');
    const readiness = await dependencies.readinessStore.get(readinessId);
    if (!readiness) throw new Error(`Pilot activation readiness ${readinessId} was not found.`);
    if (readiness.state !== 'PILOT_ACTIVATION_READY') throw new Error(`Pilot activation readiness ${readinessId} is ${readiness.state}.`);
    if (readiness.evidenceReferences.length !== 5) throw new Error('Pilot activation readiness must reference exactly five verification receipts.');

    const evidence: PilotVerificationEvidenceRecord[] = [];
    for (const reference of readiness.evidenceReferences) {
      const evidenceId = evidenceIdFromReference(reference);
      const receipt = await dependencies.evidenceStore.get(evidenceId);
      if (!receipt) throw new Error(`Pilot verification evidence ${evidenceId} was not found.`);
      if (receipt.outcome !== 'PASS') throw new Error(`Pilot verification evidence ${evidenceId} is ${receipt.outcome}.`);
      evidence.push(receipt);
    }
    const categories = new Set(evidence.map((item) => item.category));
    if (categories.size !== 5 || [...REQUIRED_CATEGORIES].some((category) => !categories.has(category as never))) {
      throw new Error('Pilot activation ceremony evidence does not contain the five required verification categories.');
    }
    return { readiness, evidence, pilotState: await dependencies.pilotStateStore.get() };
  }

  async function audit(action: PilotActivationCeremonyAuditRecord['action'], readinessId: string, reason: string, evidenceReferences: string[]) {
    const recordedAt = new Date().toISOString();
    return dependencies.auditStore.save({
      auditId: `pilot-activation-ceremony:${action.toLowerCase()}:${readinessId}:${Date.now()}`,
      readinessId,
      action,
      actor: 'human_executive',
      reason,
      evidenceReferences,
      recordedAt,
    });
  }

  return {
    async preview(readinessId: string, reason = 'Human Executive reviewed persisted pilot readiness evidence.') {
      const result = await preview(readinessId);
      await audit('PREVIEWED', result.readiness.readinessId, required(reason, 'reason'), result.readiness.evidenceReferences);
      return result;
    },

    async activate(input: { readinessId: string; reason: string; confirmation: string }) {
      if (input.confirmation !== 'ACTIVATE PILOT') throw new Error('Pilot activation requires the exact confirmation ACTIVATE PILOT.');
      const before = await preview(input.readinessId);
      if (before.pilotState.state !== 'PILOT_DISABLED') throw new Error(`Pilot activation ceremony requires PILOT_DISABLED before activation; current state is ${before.pilotState.state}.`);
      const activated = await dependencies.activationCommand.activate({ readinessId: before.readiness.readinessId, actor: 'human_executive', reason: required(input.reason, 'reason') });
      await audit('ACTIVATION_APPROVED', before.readiness.readinessId, input.reason, before.readiness.evidenceReferences);
      return activated;
    },

    async deactivate(input: { readinessId: string; reason: string; confirmation: string }) {
      if (input.confirmation !== 'DISABLE PILOT') throw new Error('Pilot deactivation requires the exact confirmation DISABLE PILOT.');
      const previewed = await preview(input.readinessId);
      const state = await dependencies.pilotStateStore.set('PILOT_DISABLED', 'human_executive', required(input.reason, 'reason'));
      if (state.state !== 'PILOT_DISABLED') throw new Error('Pilot deactivation did not produce PILOT_DISABLED.');
      await audit('DEACTIVATION_PROVED', previewed.readiness.readinessId, input.reason, previewed.readiness.evidenceReferences);
      return state;
    },
  };
}
