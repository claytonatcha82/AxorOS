import type { Pool } from 'pg';
import {
  PilotActivationReadinessPostgresStore,
  type PilotActivationReadinessRecord,
} from './pilot-activation-readiness-postgres-store.js';
import {
  PilotVerificationEvidencePostgresStore,
  type PilotVerificationEvidenceRecord,
} from './pilot-verification-evidence-postgres-store.js';
import {
  PilotActivationCeremonyAuditPostgresStore,
  type PilotActivationCeremonyAuditRecord,
} from './pilot-activation-ceremony-audit-postgres-store.js';

export type PilotSystemState = 'PILOT_DISABLED' | 'PILOT_ACTIVE';

export interface PilotSystemStateRecord {
  state: PilotSystemState;
  changedBy: string;
  reason: string;
  version: number;
  changedAt: string;
}

type Queryable = Pick<Pool, 'query'>;

export class PilotSystemStatePostgresStore {
  private readonly activationReadiness: PilotActivationReadinessPostgresStore;
  private readonly verificationEvidence: PilotVerificationEvidencePostgresStore;
  private readonly ceremonyAudit: PilotActivationCeremonyAuditPostgresStore;

  constructor(private readonly pool: Queryable) {
    this.activationReadiness = new PilotActivationReadinessPostgresStore(pool);
    this.verificationEvidence = new PilotVerificationEvidencePostgresStore(pool);
    this.ceremonyAudit = new PilotActivationCeremonyAuditPostgresStore(pool);
  }

  async getActivationReadiness(readinessId: string): Promise<PilotActivationReadinessRecord | null> {
    return this.activationReadiness.get(readinessId);
  }

  async getVerificationEvidence(evidenceId: string): Promise<PilotVerificationEvidenceRecord | null> {
    return this.verificationEvidence.get(evidenceId);
  }

  async saveActivationCeremonyAudit(record: PilotActivationCeremonyAuditRecord): Promise<'accepted' | 'replayed'> {
    return this.ceremonyAudit.save(record);
  }

  async get(): Promise<PilotSystemStateRecord> {
    const result = await this.pool.query(`select state, changed_by, reason, version, changed_at
      from runtime.pilot_system_state where singleton_key = 'axoros'`, []);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('Authoritative pilot system state is unavailable. Pilot remains disabled by policy.');
    }
    return {
      state: String(row.state) as PilotSystemState,
      changedBy: String(row.changed_by),
      reason: String(row.reason),
      version: Number(row.version),
      changedAt: new Date(String(row.changed_at)).toISOString(),
    };
  }

  async set(state: PilotSystemState, changedBy: string, reason: string): Promise<PilotSystemStateRecord> {
    const result = await this.pool.query(`update runtime.pilot_system_state
      set state = $1, changed_by = $2, reason = $3, version = version + 1,
          changed_at = now(), updated_at = now()
      where singleton_key = 'axoros'
      returning state, changed_by, reason, version, changed_at`, [state, changedBy, reason]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('Authoritative pilot system state could not be updated.');
    return {
      state: String(row.state) as PilotSystemState,
      changedBy: String(row.changed_by),
      reason: String(row.reason),
      version: Number(row.version),
      changedAt: new Date(String(row.changed_at)).toISOString(),
    };
  }
}
