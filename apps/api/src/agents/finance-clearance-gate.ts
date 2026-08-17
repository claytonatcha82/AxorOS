import type { PaymentVerificationInput, PaymentVerificationResponse } from '../integrations/payment-integration.js';
import { hasVerifiedPaymentEvidence } from '../integrations/payment-integration.js';

export type FinanceClearanceState = 'FINANCE_CLEARED' | 'FINANCE_PENDING';

export interface FinanceClearanceDecision {
  state: FinanceClearanceState;
  commercialRecordReference: string;
  reason: string;
  evidenceReferences: string[];
}

export function evaluateFinanceClearance(
  expected: PaymentVerificationInput,
  verification: PaymentVerificationResponse,
): FinanceClearanceDecision {
  const pending = (reason: string): FinanceClearanceDecision => ({
    state: 'FINANCE_PENDING',
    commercialRecordReference: expected.commercialRecordReference,
    reason,
    evidenceReferences: verification.evidenceReferences,
  });

  if (!hasVerifiedPaymentEvidence(verification)) return pending('Payment awaiting verification.');
  if (verification.output.commercialRecordReference !== expected.commercialRecordReference) return pending('Payment evidence does not match the commercial record.');
  if (verification.output.providerPaymentReference !== expected.providerPaymentReference) return pending('Payment evidence does not match the expected provider payment reference.');
  if (verification.output.amountMinor !== expected.expectedAmountMinor) return pending('Verified payment amount does not match the expected amount.');
  if (verification.output.currency !== expected.currency) return pending('Verified payment currency does not match the expected currency.');

  return {
    state: 'FINANCE_CLEARED',
    commercialRecordReference: expected.commercialRecordReference,
    reason: 'Provider payment evidence matches the governed commercial record.',
    evidenceReferences: verification.evidenceReferences,
  };
}

export function assertFinanceCleared(decision: FinanceClearanceDecision): void {
  if (decision.state !== 'FINANCE_CLEARED') {
    throw new Error(`Production start blocked: ${decision.reason}`);
  }
}
