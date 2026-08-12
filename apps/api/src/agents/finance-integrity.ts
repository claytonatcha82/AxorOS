export interface ProviderEventIdentity { provider: string; providerEventId: string; }

export function financeEventKey(event: ProviderEventIdentity): string {
  if (!event.provider.trim() || !event.providerEventId.trim()) throw new Error('provider and providerEventId are required.');
  return `${event.provider.trim()}:${event.providerEventId.trim()}`;
}

export function isDuplicateProviderEvent(processedKeys: ReadonlySet<string>, event: ProviderEventIdentity): boolean {
  return processedKeys.has(financeEventKey(event));
}

export interface ReconciliationRun {
  provider: string;
  expectedTransactions: number;
  providerTransactions: number;
  matched: number;
  missingInternal: number;
  missingProvider: number;
  amountMismatches: number;
}

export function reconciliationStatus(run: ReconciliationRun): 'MATCHED' | 'EXCEPTIONS' {
  return run.missingInternal === 0 && run.missingProvider === 0 && run.amountMismatches === 0 && run.matched === run.expectedTransactions && run.matched === run.providerTransactions ? 'MATCHED' : 'EXCEPTIONS';
}

export interface ManualAdjustment {
  adjustmentId: string; recordType: string; recordId: string; previousValue: string; newValue: string; reason: string; evidence: string[]; requestedBy: string; approvedBy?: string;
}

export function manualAdjustmentMayApply(adjustment: ManualAdjustment): boolean {
  return Boolean(adjustment.adjustmentId.trim() && adjustment.recordId.trim() && adjustment.reason.trim() && adjustment.evidence.length > 0 && adjustment.requestedBy.trim() && adjustment.approvedBy?.trim());
}

export interface RefundAssessment { originalAmountMinor: number; alreadyRefundedMinor: number; requestedAmountMinor: number; policySupported: boolean; humanApproved: boolean; }
export function refundMayExecute(input: RefundAssessment): boolean {
  const refundable = input.originalAmountMinor - input.alreadyRefundedMinor;
  return input.requestedAmountMinor > 0 && input.requestedAmountMinor <= refundable && input.policySupported && input.humanApproved;
}
