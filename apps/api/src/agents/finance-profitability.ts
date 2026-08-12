export interface ProjectFinancialSummaryInput {
  projectId: string;
  contractValueMinor: number;
  approvedChangeRequestsMinor: number;
  totalRevenueMinor: number;
  paymentProcessingFeesMinor: number;
  aiCostsMinor: number;
  hostingCostsMinor: number;
  softwareCostsMinor: number;
  contractorCostsMinor: number;
  otherDirectCostsMinor: number;
  outstandingReceivablesMinor: number;
  refundsMinor: number;
}

export interface ProjectFinancialSummary extends ProjectFinancialSummaryInput {
  totalDirectCostMinor: number;
  grossProfitMinor: number;
  grossMargin: number | null;
}

export function calculateProjectFinancialSummary(input: ProjectFinancialSummaryInput): ProjectFinancialSummary {
  const values = Object.values(input).filter((value): value is number => typeof value === 'number');
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('financial amounts must be non-negative safe integers.');
  const totalDirectCostMinor = input.paymentProcessingFeesMinor + input.aiCostsMinor + input.hostingCostsMinor + input.softwareCostsMinor + input.contractorCostsMinor + input.otherDirectCostsMinor;
  const grossProfitMinor = input.totalRevenueMinor - input.refundsMinor - totalDirectCostMinor;
  const netRevenueMinor = input.totalRevenueMinor - input.refundsMinor;
  const grossMargin = netRevenueMinor > 0 ? grossProfitMinor / netRevenueMinor : null;
  return { ...input, totalDirectCostMinor, grossProfitMinor, grossMargin };
}

export interface AiCostEvent { provider: string; model: string; agentId: string; projectId?: string; clientId?: string; tokensInput: number; tokensOutput: number; providerCostMinor: number; currency: string; recordedAt: string; }
export function validateAiCostEvent(event: AiCostEvent): string[] {
  const errors: string[] = [];
  if (!event.provider.trim() || !event.model.trim() || !event.agentId.trim()) errors.push('provider model and agentId are required.');
  if (!Number.isSafeInteger(event.tokensInput) || event.tokensInput < 0 || !Number.isSafeInteger(event.tokensOutput) || event.tokensOutput < 0) errors.push('token counts must be non-negative integers.');
  if (!Number.isSafeInteger(event.providerCostMinor) || event.providerCostMinor < 0) errors.push('providerCostMinor must be a non-negative safe integer.');
  if (!/^[A-Z]{3}$/.test(event.currency)) errors.push('currency must be explicit.');
  return errors;
}
