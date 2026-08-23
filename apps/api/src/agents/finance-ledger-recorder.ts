import { createHash } from 'node:crypto';
import { createFinanceLedgerEntry, type FinanceLedgerEntry, type FinanceLedgerEntryType, type FinanceLedgerAuthorityType } from './finance-ledger-entry.js';

export interface FinanceLedgerRecorderStore {
  save(entry: FinanceLedgerEntry): Promise<'accepted' | 'duplicate'>;
}

export interface RecordFinanceLedgerAuthorityInput {
  entryType: FinanceLedgerEntryType;
  commercialRecordReference: string;
  authorityType: FinanceLedgerAuthorityType;
  authorityReference: string;
  evidenceReferences: readonly string[];
  amountMinor?: number;
  currency?: string;
  occurredAt: string;
}

function entryId(input: RecordFinanceLedgerAuthorityInput): string {
  const digest = createHash('sha256')
    .update(`${input.entryType}|${input.authorityType}|${input.authorityReference}`)
    .digest('hex')
    .slice(0, 32);
  return `finance-ledger:${digest}`;
}

export function createFinanceLedgerRecorder(store: FinanceLedgerRecorderStore) {
  return {
    async record(input: RecordFinanceLedgerAuthorityInput): Promise<{ entry: FinanceLedgerEntry; persistence: 'accepted' | 'duplicate' }> {
      const entry = createFinanceLedgerEntry({
        entryId: entryId(input),
        entryType: input.entryType,
        commercialRecordReference: input.commercialRecordReference,
        authorityType: input.authorityType,
        authorityReference: input.authorityReference,
        evidenceReferences: input.evidenceReferences,
        occurredAt: input.occurredAt,
        ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        // Deterministic recordedAt keeps exact authority retries byte-for-byte idempotent.
        recordedAt: input.occurredAt,
      });
      const persistence = await store.save(entry);
      return { entry, persistence };
    },
  };
}
