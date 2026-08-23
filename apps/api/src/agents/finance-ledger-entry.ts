export type FinanceLedgerEntryType =
  | 'PAYMENT_REQUIREMENT_CREATED'
  | 'PAYMENT_REQUEST_CREATED'
  | 'PAYMENT_PROVIDER_STATE_OBSERVED'
  | 'FINANCE_CLEARANCE_CREATED'
  | 'PAYMENT_REQUIREMENT_SATISFIED'
  | 'PAYMENT_ADVERSE_EVENT_OBSERVED';

export type FinanceLedgerAuthorityType =
  | 'commercial_payment_requirement'
  | 'finance_payment_request'
  | 'payment_provider_evidence'
  | 'finance_clearance'
  | 'commercial_payment_satisfaction';

export interface FinanceLedgerEntry {
  entryId: string;
  entryType: FinanceLedgerEntryType;
  commercialRecordReference: string;
  authorityType: FinanceLedgerAuthorityType;
  authorityReference: string;
  evidenceReferences: readonly string[];
  amountMinor?: number;
  currency?: string;
  occurredAt: string;
  recordedAt: string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function isoTimestamp(value: string, label: string): string {
  const normalized = required(value, label);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp.`);
  return new Date(timestamp).toISOString();
}

export function validateFinanceLedgerEntry(entry: FinanceLedgerEntry): string[] {
  const errors: string[] = [];
  if (!entry.entryId.trim()) errors.push('entryId is required.');
  if (!entry.commercialRecordReference.trim()) errors.push('commercialRecordReference is required.');
  if (!entry.authorityReference.trim()) errors.push('authorityReference is required.');
  if (entry.evidenceReferences.length === 0) errors.push('at least one evidence reference is required.');
  if (entry.evidenceReferences.some((reference) => !reference.trim())) errors.push('evidence references must be non-empty.');
  if (entry.amountMinor !== undefined && (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 0)) {
    errors.push('amountMinor must be a non-negative safe integer when supplied.');
  }
  if (entry.currency !== undefined && !/^[A-Z]{3}$/.test(entry.currency)) {
    errors.push('currency must be a three-letter uppercase code when supplied.');
  }
  if ((entry.amountMinor === undefined) !== (entry.currency === undefined)) {
    errors.push('amountMinor and currency must be supplied together.');
  }
  if (!Number.isFinite(Date.parse(entry.occurredAt))) errors.push('occurredAt must be a valid timestamp.');
  if (!Number.isFinite(Date.parse(entry.recordedAt))) errors.push('recordedAt must be a valid timestamp.');
  return errors;
}

export interface CreateFinanceLedgerEntryInput {
  entryId: string;
  entryType: FinanceLedgerEntryType;
  commercialRecordReference: string;
  authorityType: FinanceLedgerAuthorityType;
  authorityReference: string;
  evidenceReferences: readonly string[];
  amountMinor?: number;
  currency?: string;
  occurredAt: string;
  recordedAt?: string;
}

export function createFinanceLedgerEntry(input: CreateFinanceLedgerEntryInput): FinanceLedgerEntry {
  const entry: FinanceLedgerEntry = {
    entryId: required(input.entryId, 'Finance ledger entryId'),
    entryType: input.entryType,
    commercialRecordReference: required(input.commercialRecordReference, 'Finance ledger commercial record reference'),
    authorityType: input.authorityType,
    authorityReference: required(input.authorityReference, 'Finance ledger authority reference'),
    evidenceReferences: input.evidenceReferences.map((reference) => required(reference, 'Finance ledger evidence reference')),
    occurredAt: isoTimestamp(input.occurredAt, 'Finance ledger occurredAt'),
    recordedAt: isoTimestamp(input.recordedAt ?? new Date().toISOString(), 'Finance ledger recordedAt'),
    ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
  };

  const errors = validateFinanceLedgerEntry(entry);
  if (errors.length > 0) throw new Error(`Invalid Finance ledger entry: ${errors.join(' ')}`);
  return entry;
}
