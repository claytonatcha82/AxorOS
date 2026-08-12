export interface FinanceKpis {
  totalRevenueMinor: number; cashReceivedMinor: number; outstandingReceivablesMinor: number; overdueReceivablesMinor: number;
  averageCollectionDays: number; paymentFailureRate: number; paymentProcessingFeesMinor: number; monthlyRecurringRevenueMinor: number;
  recurringPaymentFailureRate: number; refundRate: number; disputeRate: number; grossProfitMinor: number; grossMargin: number;
  aiCostMinor: number; infrastructureCostMinor: number; invoiceAccuracyRate: number; reconciliationExceptionRate: number;
  financeGateFailureRate: number; financialDataCorrectionRate: number;
}

export function validateFinanceKpis(kpis: FinanceKpis): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(kpis)) {
    if (!Number.isFinite(value)) errors.push(`${name} must be finite.`);
  }
  for (const name of ['paymentFailureRate','recurringPaymentFailureRate','refundRate','disputeRate','invoiceAccuracyRate','reconciliationExceptionRate','financeGateFailureRate','financialDataCorrectionRate'] as const) {
    const value = kpis[name]; if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  }
  return errors;
}

export function aiCostPercentageOfRevenue(aiCostMinor: number, revenueMinor: number): number | null {
  return revenueMinor > 0 ? (aiCostMinor / revenueMinor) * 100 : null;
}

export type FinanceTask = 'invoice_status' | 'payment_confirmation' | 'balance_calculation' | 'routine_reminder' | 'complex_dispute_summary' | 'financial_strategy';
export function financeExecutionRoute(task: FinanceTask): 'deterministic_query' | 'provider_verification' | 'deterministic_code' | 'small_language_model' | 'strong_reasoning' | 'executive_human_review' {
  if (task === 'invoice_status') return 'deterministic_query';
  if (task === 'payment_confirmation') return 'provider_verification';
  if (task === 'balance_calculation') return 'deterministic_code';
  if (task === 'routine_reminder') return 'small_language_model';
  if (task === 'complex_dispute_summary') return 'strong_reasoning';
  return 'executive_human_review';
}
