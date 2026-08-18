import type { PaymentStatus } from './finance-state.js';
import type { PaymentWebhookEvidence, PaymentWebhookEventType } from '../integrations/payment-webhook-evidence.js';

export type FinancePaymentAuthorityState = 'AUTHORIZED' | 'BLOCKED' | 'MANUAL_REVIEW';

export interface FinancePaymentLifecycleState {
  paymentStatus: PaymentStatus;
  authorityState: FinancePaymentAuthorityState;
  reason: string;
  evidenceReference: string;
  occurredAt: string;
}

const EVENT_STATE: Record<PaymentWebhookEventType, Omit<FinancePaymentLifecycleState, 'evidenceReference' | 'occurredAt'>> = {
  payment_paid: {
    paymentStatus: 'CONFIRMED',
    authorityState: 'AUTHORIZED',
    reason: 'Verified provider payment confirmation supports Finance authorization.',
  },
  payment_pending: {
    paymentStatus: 'PENDING',
    authorityState: 'BLOCKED',
    reason: 'Payment is still pending provider confirmation.',
  },
  payment_failed: {
    paymentStatus: 'FAILED',
    authorityState: 'BLOCKED',
    reason: 'Provider reported the payment as failed.',
  },
  payment_refunded: {
    paymentStatus: 'REFUNDED',
    authorityState: 'BLOCKED',
    reason: 'Refunded payment no longer supports Finance authorization.',
  },
  payment_reversed: {
    paymentStatus: 'CANCELLED',
    authorityState: 'BLOCKED',
    reason: 'Reversed payment no longer supports Finance authorization.',
  },
  payment_disputed: {
    paymentStatus: 'DISPUTED',
    authorityState: 'MANUAL_REVIEW',
    reason: 'Disputed payment requires Finance and Executive review.',
  },
  payment_chargeback: {
    paymentStatus: 'CHARGEBACK',
    authorityState: 'BLOCKED',
    reason: 'Chargeback invalidates payment-dependent Finance authorization.',
  },
  unknown: {
    paymentStatus: 'PENDING',
    authorityState: 'MANUAL_REVIEW',
    reason: 'Unknown provider payment event requires manual review.',
  },
};

export function evaluateFinancePaymentLifecycle(evidence: PaymentWebhookEvidence): FinancePaymentLifecycleState {
  const mapped = EVENT_STATE[evidence.eventType];
  return {
    ...mapped,
    evidenceReference: evidence.evidenceReference,
    occurredAt: new Date(evidence.occurredAt).toISOString(),
  };
}

export function paymentLifecycleSupportsFinanceAuthorization(state: FinancePaymentLifecycleState): boolean {
  return state.authorityState === 'AUTHORIZED' && state.paymentStatus === 'CONFIRMED';
}
