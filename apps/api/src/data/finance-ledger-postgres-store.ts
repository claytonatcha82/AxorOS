import type { Pool } from 'pg';
import type { FinanceLedgerEntry } from '../agents/finance-ledger-entry.js';

export class FinanceLedgerIntegrityConflictError extends Error {
  constructor(reference: string) {
    super(`Finance ledger integrity conflict for ${reference}.`);
    this.name = 'FinanceLedgerIntegrityConflictError';
  }
}

function parseEvidenceReferences(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error('Persisted Finance ledger evidence is invalid.');
  }
  return parsed;
}

function normaliseTimestamp(value: unknown, label: string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Persisted Finance ledger ${label} is invalid.`);
  return parsed.toISOString();
}

function rowToEntry(row: Record<string, unknown>): FinanceLedgerEntry {
  return {
    entryId: String(row.entry_id),
    entryType: String(row.entry_type) as FinanceLedgerEntry['entryType'],
    commercialRecordReference: String(row.commercial_record_reference),
    authorityType: String(row.authority_type) as FinanceLedgerEntry['authorityType'],
    authorityReference: String(row.authority_reference),
    evidenceReferences: parseEvidenceReferences(row.evidence_references),
    occurredAt: normaliseTimestamp(row.occurred_at, 'occurred_at'),
    recordedAt: normaliseTimestamp(row.recorded_at, 'recorded_at'),
    ...(row.amount_minor === null || row.amount_minor === undefined ? {} : { amountMinor: Number(row.amount_minor) }),
    ...(row.currency === null || row.currency === undefined ? {} : { currency: String(row.currency) }),
  };
}

function sameEntry(existing: FinanceLedgerEntry, incoming: FinanceLedgerEntry): boolean {
  return existing.entryId === incoming.entryId
    && existing.entryType === incoming.entryType
    && existing.commercialRecordReference === incoming.commercialRecordReference
    && existing.authorityType === incoming.authorityType
    && existing.authorityReference === incoming.authorityReference
    && existing.amountMinor === incoming.amountMinor
    && existing.currency === incoming.currency
    && existing.occurredAt === incoming.occurredAt
    && existing.recordedAt === incoming.recordedAt
    && existing.evidenceReferences.length === incoming.evidenceReferences.length
    && existing.evidenceReferences.every((reference, index) => reference === incoming.evidenceReferences[index]);
}

export class FinanceLedgerPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(entryId: string): Promise<FinanceLedgerEntry | null> {
    const result = await this.pool.query(
      `select entry_id, entry_type, commercial_record_reference, authority_type, authority_reference,
              evidence_references, amount_minor, currency, occurred_at, recorded_at
         from finance.ledger_entries
        where entry_id = $1
        limit 1`,
      [entryId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : null;
  }

  async getByAuthority(
    entryType: FinanceLedgerEntry['entryType'],
    authorityType: FinanceLedgerEntry['authorityType'],
    authorityReference: string,
  ): Promise<FinanceLedgerEntry | null> {
    const result = await this.pool.query(
      `select entry_id, entry_type, commercial_record_reference, authority_type, authority_reference,
              evidence_references, amount_minor, currency, occurred_at, recorded_at
         from finance.ledger_entries
        where entry_type = $1 and authority_type = $2 and authority_reference = $3
        limit 1`,
      [entryType, authorityType, authorityReference],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : null;
  }

  async save(entry: FinanceLedgerEntry): Promise<'accepted' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into finance.ledger_entries
         (entry_id, entry_type, commercial_record_reference, authority_type, authority_reference,
          evidence_references, amount_minor, currency, occurred_at, recorded_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       on conflict do nothing
       returning entry_id`,
      [entry.entryId, entry.entryType, entry.commercialRecordReference, entry.authorityType,
       entry.authorityReference, JSON.stringify(entry.evidenceReferences), entry.amountMinor ?? null,
       entry.currency ?? null, entry.occurredAt, entry.recordedAt],
    );
    if (result.rowCount === 1) return 'accepted';

    const existingById = await this.get(entry.entryId);
    if (existingById) {
      if (sameEntry(existingById, entry)) return 'duplicate';
      throw new FinanceLedgerIntegrityConflictError(entry.entryId);
    }

    const existingAuthority = await this.getByAuthority(entry.entryType, entry.authorityType, entry.authorityReference);
    if (existingAuthority && sameEntry(existingAuthority, entry)) return 'duplicate';
    throw new FinanceLedgerIntegrityConflictError(`${entry.entryType}:${entry.authorityType}:${entry.authorityReference}`);
  }
}
