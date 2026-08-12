export type InvoiceStatus = 'DRAFT' | 'APPROVED' | 'ISSUED' | 'SENT' | 'VIEWED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'CANCELLED' | 'OVERDUE' | 'DISPUTED' | 'WRITTEN_OFF' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentStatus = 'CREATED' | 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'SETTLED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'CHARGEBACK' | 'DISPUTED';
export type FinanceGateStatus = 'NOT_REQUIRED' | 'WAITING' | 'PASSED' | 'FAILED' | 'MANUAL_REVIEW';

const invoiceTransitions: Partial<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  DRAFT: ['APPROVED', 'VOID', 'CANCELLED'], APPROVED: ['ISSUED', 'VOID', 'CANCELLED'], ISSUED: ['SENT', 'CANCELLED'], SENT: ['VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED'], VIEWED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED'], PARTIALLY_PAID: ['PAID', 'OVERDUE', 'DISPUTED', 'PARTIALLY_REFUNDED', 'REFUNDED'], PAID: ['DISPUTED', 'PARTIALLY_REFUNDED', 'REFUNDED'], OVERDUE: ['PARTIALLY_PAID', 'PAID', 'DISPUTED', 'WRITTEN_OFF'], DISPUTED: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'WRITTEN_OFF'],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean { return invoiceTransitions[from]?.includes(to) ?? false; }

export interface FinancialGateInput { required: boolean; requiredAmountMinor: number; confirmedAmountMinor: number; providerVerified: boolean; disputed: boolean; }
export function evaluateFinancialGate(input: FinancialGateInput): FinanceGateStatus {
  if (!input.required) return 'NOT_REQUIRED';
  if (input.disputed) return 'MANUAL_REVIEW';
  if (!input.providerVerified) return 'WAITING';
  return input.confirmedAmountMinor >= input.requiredAmountMinor ? 'PASSED' : 'WAITING';
}

export function invoicePaymentStatus(totalMinor: number, paidMinor: number): 'SENT' | 'PARTIALLY_PAID' | 'PAID' {
  if (paidMinor <= 0) return 'SENT';
  if (paidMinor < totalMinor) return 'PARTIALLY_PAID';
  return 'PAID';
}
