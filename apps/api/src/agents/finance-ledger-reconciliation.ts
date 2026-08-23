import type { FinanceLedgerEntry, FinanceLedgerEntryType } from './finance-ledger-entry.js';

export type FinanceLedgerReconciliationIssueCode =
  | 'PAYMENT_REQUEST_WITHOUT_REQUIREMENT'
  | 'PROVIDER_STATE_WITHOUT_PAYMENT_REQUEST'
  | 'CLEARANCE_WITHOUT_PROVIDER_STATE'
  | 'SATISFACTION_WITHOUT_CLEARANCE'
  | 'CLEARANCE_WITHOUT_SATISFACTION';

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

export function reconcileFinanceLedger(
  commercialRecordReference: string,
  entries: readonly FinanceLedgerEntry[],
): FinanceLedgerReconciliationResult {
  const scoped = entries.filter((entry) => entry.commercialRecordReference === commercialRecordReference);
  const issues: FinanceLedgerReconciliationIssue[] = [];

  const requirement = has(scoped, 'PAYMENT_REQUIREMENT_CREATED');
  const request = has(scoped, 'PAYMENT_REQUEST_CREATED');
  const providerState = has(scoped, 'PAYMENT_PROVIDER_STATE_OBSERVED');
  const clearance = has(scoped, 'FINANCE_CLEARANCE_CREATED');
  const satisfaction = has(scoped, 'PAYMENT_REQUIREMENT_SATISFIED');

  if (request && !requirement) issues.push({ code: 'PAYMENT_REQUEST_WITHOUT_REQUIREMENT', message: 'Payment request ledger authority exists without a commercial payment requirement authority.' });
  if (providerState && !request) issues.push({ code: 'PROVIDER_STATE_WITHOUT_PAYMENT_REQUEST', message: 'Provider payment state exists without a persisted payment request authority.' });
  if (clearance && !providerState) issues.push({ code: 'CLEARANCE_WITHOUT_PROVIDER_STATE', message: 'Finance clearance exists without trusted provider-state ledger evidence.' });
  if (satisfaction && !clearance) issues.push({ code: 'SATISFACTION_WITHOUT_CLEARANCE', message: 'Commercial payment satisfaction exists without matching Finance clearance ledger authority.' });
  if (clearance && !satisfaction) issues.push({ code: 'CLEARANCE_WITHOUT_SATISFACTION', message: 'Finance clearance exists without matching commercial payment satisfaction ledger authority.' });

  return {
    commercialRecordReference,
    reconciled: issues.length === 0,
    entryTypes: scoped.map((entry) => entry.entryType),
    issues,
  };
}
