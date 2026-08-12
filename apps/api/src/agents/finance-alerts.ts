export type FinanceAlertType = 'invoice_overdue' | 'large_payment_failed' | 'payment_dispute_opened' | 'refund_requested' | 'project_margin_below_threshold' | 'ai_cost_high' | 'subscription_payment_failed' | 'reconciliation_mismatch' | 'payment_project_state_mismatch' | 'duplicate_invoice_attempt' | 'unusual_manual_adjustment';
export type FinanceWorkflowEvent = 'PAYMENT_REQUIRED' | 'PAYMENT_CONFIRMED' | 'PAYMENT_OVERDUE' | 'FINANCE_HOLD' | 'FINANCE_CLEARED' | 'REFUND_PENDING' | 'DISPUTE_OPENED' | 'SUBSCRIPTION_PAST_DUE';

export interface FinanceGateResponse {
  projectId: string; gateType: 'production_start' | 'change_request' | 'deployment'; required: boolean;
  status: 'NOT_REQUIRED' | 'WAITING' | 'PASSED' | 'FAILED' | 'MANUAL_REVIEW'; verified: boolean;
  blockingReason?: string; invoiceReference?: string; checkedAt: string;
}

export interface ExecutiveFinanceSummary {
  currency: string; revenueMinor: number; paymentsReceivedMinor: number; outstandingMinor: number; overdueMinor: number;
  recurringRevenueMinor: number; operatingCostMinor: number; grossProfitMinor: number; aiSpendMinor: number;
  projectsBelowMarginTarget: number; financialHolds: number; exceptions: FinanceAlertType[];
}

export function workflowEventForGate(response: FinanceGateResponse): FinanceWorkflowEvent {
  if (response.status === 'PASSED' || response.status === 'NOT_REQUIRED') return 'FINANCE_CLEARED';
  return 'FINANCE_HOLD';
}
