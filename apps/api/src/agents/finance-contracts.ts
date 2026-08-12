export interface Money { amountMinor: number; currency: string; }

export interface FinanceRequest {
  financeRequestId: string; requestType: string; clientId: string; projectId?: string; sourceAgent: string; commercialReference: string; money: Money; taxTreatment: string; paymentType: string; paymentStage: string; dueDate?: string; description: string; invoiceRequired: boolean; paymentLinkRequired: boolean; approvalStatus: string; supportingRecords: string[]; notes?: string;
}

export interface FinanceEvent {
  financeEventId: string; eventType: string; clientId: string; projectId?: string; invoiceId?: string; paymentId?: string; expenseId?: string; money: Money; provider?: string; providerReference?: string; previousStatus?: string; newStatus: string; verified: boolean; verificationSource: string; occurredAt: string; recordedAt: string; initiatedBy: string; approvalReference?: string; metadata?: Record<string, unknown>;
}

export function validateMoney(money: Money): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor < 0) errors.push('amountMinor must be a non-negative safe integer.');
  if (!/^[A-Z]{3}$/.test(money.currency)) errors.push('currency must be an explicit ISO-style three-letter code.');
  return errors;
}

export function validateFinanceRequest(request: FinanceRequest): string[] {
  const errors = validateMoney(request.money);
  if (!request.financeRequestId.trim()) errors.push('financeRequestId is required.');
  if (!request.clientId.trim()) errors.push('clientId is required.');
  if (!request.sourceAgent.trim()) errors.push('sourceAgent is required.');
  if (!request.commercialReference.trim()) errors.push('commercialReference is required.');
  if (!request.description.trim()) errors.push('description is required.');
  if (request.supportingRecords.length === 0) errors.push('supportingRecords are required.');
  return errors;
}
