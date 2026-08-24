import type { FinanceLedgerEntry, FinanceLedgerEntryType } from './finance-ledger-entry.js';

export type FinanceLedgerReconciliationIssueCode =
  | 'PAYMENT_REQUEST_WITHOUT_REQUIREMENT'
  | 'PROVIDER_STATE_WITHOUT_PAYMENT_REQUEST'
  | 'CLEARANCE_WITHOUT_PROVIDER_STATE'
  | 'SATISFACTION_WITHOUT_CLEARANCE'
  | 'CLEARANCE_WITHOUT_SATISFACTION'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'PAYMENT_REQUEST_REQUIREMENT_REFERENCE_MISMATCH'
  | 'PROVIDER_PAYMENT_REQUEST_REFERENCE_MISMATCH'
  | 'CLEARANCE_PROVIDER_REFERENCE_MISMATCH'
  | 'SATISFACTION_CLEARANCE_REFERENCE_MISMATCH';

export interface FinanceLedgerReconciliationIssue {
  code: FinanceLedgerReconciliationIssueCode;
  message: string;
}

export interface FinanceLedgerReconciliationResult {
  commercialRecordReference: string;
  reconciled: boolean;
  entryTypes: FinanceLedgerEntryType[];
  issues: FinanceLedgerReconciliationIssue[];
}

function has(entries: readonly FinanceLedgerEntry[], type: FinanceLedgerEntryType): boolean {
  return entries.some((entry) => entry.entryType === type);
}

function first(entries: readonly FinanceLedgerEntry[], type: FinanceLedgerEntryType): FinanceLedgerEntry | undefined {
  return entries.find((entry) => entry.entryType === type);
}

function references(entry: FinanceLedgerEntry | undefined, authorityReference: string | undefined): boolean {
  return entry !== undefined
    && authorityReference !== undefined
    && entry.evidenceReferences.includes(authorityReference);
}

function financialEntries(entries: readonly FinanceLedgerEntry[]): FinanceLedgerEntry[] {
  return entries.filter((entry) =>
    entry.entryType === 'PAYMENT_REQUIREMENT_CREATED'
    || entry.entryType === 'PAYMENT_REQUEST_CREATED'
    || entry.entryType === 'PAYMENT_PROVIDER_STATE_OBSERVED'
    || entry.entryType === 'FINANCE_CLEARANCE_CREATED'
    || entry.entryType === 'PAYMENT_REQUIREMENT_SATISFIED'
  );
}

export function reconcileFinanceLedger(
  commercialRecordReference: string,
  entries: readonly FinanceLedgerEntry[],
): FinanceLedgerReconciliationResult {
  const scoped = entries.filter((entry) => entry.commercialRecordReference === commercialRecordReference);
  const issues: FinanceLedgerReconciliationIssue[] = [];

  const requirement = first(scoped, 'PAYMENT_REQUIREMENT_CREATED');
  const request = first(scoped, 'PAYMENT_REQUEST_CREATED');
  const providerState = first(scoped, 'PAYMENT_PROVIDER_STATE_OBSERVED');
  const clearance = first(scoped, 'FINANCE_CLEARANCE_CREATED');
  const satisfaction = first(scoped, 'PAYMENT_REQUIREMENT_SATISFIED');

  if (request && !requirement) issues.push({ code: 'PAYMENT_REQUEST_WITHOUT_REQUIREMENT', message: 'Payment request ledger authority exists without a commercial payment requirement authority.' });
  if (providerState && !request) issues.push({ code: 'PROVIDER_STATE_WITHOUT_PAYMENT_REQUEST', message: 'Provider payment state exists without a persisted payment request authority.' });
  if (clearance && !providerState) issues.push({ code: 'CLEARANCE_WITHOUT_PROVIDER_STATE', message: 'Finance clearance exists without trusted provider-state ledger evidence.' });
  if (satisfaction && !clearance) issues.push({ code: 'SATISFACTION_WITHOUT_CLEARANCE', message: 'Commercial payment satisfaction exists without matching Finance clearance ledger authority.' });
  if (clearance && !satisfaction) issues.push({ code: 'CLEARANCE_WITHOUT_SATISFACTION', message: 'Finance clearance exists without matching commercial payment satisfaction ledger authority.' });

  if (requirement && request && !references(request, requirement.authorityReference)) {
    issues.push({ code: 'PAYMENT_REQUEST_REQUIREMENT_REFERENCE_MISMATCH', message: 'Payment request authority does not reference the persisted commercial payment requirement authority.' });
  }
  if (request && providerState && !references(providerState, request.authorityReference)) {
    issues.push({ code: 'PROVIDER_PAYMENT_REQUEST_REFERENCE_MISMATCH', message: 'Provider payment-state authority does not reference the persisted payment request authority.' });
  }
  if (providerState && clearance && !references(clearance, providerState.authorityReference)) {
    issues.push({ code: 'CLEARANCE_PROVIDER_REFERENCE_MISMATCH', message: 'Finance clearance authority does not reference the trusted provider-state authority.' });
  }
  if (clearance && satisfaction && !references(satisfaction, clearance.authorityReference)) {
    issues.push({ code: 'SATISFACTION_CLEARANCE_REFERENCE_MISMATCH', message: 'Commercial payment satisfaction authority does not reference the Finance clearance authority.' });
  }

  const financiallyAuthoritative = financialEntries(scoped);
  const amounts = new Set(financiallyAuthoritative.flatMap((entry) => entry.amountMinor === undefined ? [] : [entry.amountMinor]));
  const currencies = new Set(financiallyAuthoritative.flatMap((entry) => entry.currency === undefined ? [] : [entry.currency]));

  if (amounts.size > 1) {
    issues.push({
      code: 'AMOUNT_MISMATCH',
      message: `Finance ledger authorities disagree on amountMinor: ${[...amounts].sort((a, b) => a - b).join(', ')}.`,
    });
  }
  if (currencies.size > 1) {
    issues.push({
      code: 'CURRENCY_MISMATCH',
      message: `Finance ledger authorities disagree on currency: ${[...currencies].sort().join(', ')}.`,
    });
  }

  return {
    commercialRecordReference,
    reconciled: issues.length === 0,
    entryTypes: scoped.map((entry) => entry.entryType),
    issues,
  };
}
