export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

export interface SubscriptionRecord {
  subscriptionId: string; clientId: string; service: string; billingFrequency: 'monthly' | 'quarterly' | 'annual' | 'custom'; amountMinor: number; currency: string; startDate: string; nextBillingDate?: string; status: SubscriptionStatus; autoRenew: boolean; paymentMethodReference?: string; invoicePolicy: string; cancellationDate?: string;
}

export function validateSubscription(record: SubscriptionRecord): string[] {
  const errors: string[] = [];
  if (!record.subscriptionId.trim()) errors.push('subscriptionId is required.');
  if (!record.clientId.trim()) errors.push('clientId is required.');
  if (!record.service.trim()) errors.push('service is required.');
  if (!Number.isSafeInteger(record.amountMinor) || record.amountMinor < 0) errors.push('amountMinor must be a non-negative safe integer.');
  if (!/^[A-Z]{3}$/.test(record.currency)) errors.push('currency must be explicit.');
  if (!record.invoicePolicy.trim()) errors.push('invoicePolicy is required.');
  return errors;
}

export function mayAccessFinanceRecord(requestingClientId: string, recordClientId: string): boolean {
  return Boolean(requestingClientId.trim()) && requestingClientId === recordClientId;
}

export function subscriptionFailureEvent(status: SubscriptionStatus): 'SUBSCRIPTION_PAST_DUE' | 'FINANCE_HOLD' | null {
  if (status === 'PAST_DUE') return 'SUBSCRIPTION_PAST_DUE';
  if (status === 'SUSPENDED') return 'FINANCE_HOLD';
  return null;
}
