export type SupportTicketClassification = 'incident' | 'bug' | 'content_update' | 'question' | 'training' | 'feature_request' | 'billing_question' | 'access_issue' | 'performance_issue' | 'security_issue' | 'change_request';
export type SupportSeverity = 'P1' | 'P2' | 'P3' | 'P4';

export interface SeverityFactors {
  businessImpact: number;
  usersAffected: number;
  revenueImpact: number;
  securityImpact: number;
  timeSensitivity: number;
}

export function classifySeverity(factors: SeverityFactors): SupportSeverity {
  const values = Object.values(factors);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 4)) throw new Error('severity factors must be integers between 0 and 4.');
  if (factors.securityImpact === 4) return 'P1';
  const score = values.reduce((sum, value) => sum + value, 0);
  if (score >= 16) return 'P1';
  if (score >= 11) return 'P2';
  if (score >= 5) return 'P3';
  return 'P4';
}

export interface SupportEntitlementDecision {
  classification: SupportTicketClassification;
  includedInPlan: boolean;
  contractActive: boolean;
}

export function routeSupportRequest(input: SupportEntitlementDecision): 'support' | 'sales_pricing' | 'commercial_review' {
  if (!input.contractActive) return 'commercial_review';
  if (input.classification === 'feature_request' || input.classification === 'change_request' || !input.includedInPlan) return 'sales_pricing';
  return 'support';
}

export function requiresImmediateGovernance(classification: SupportTicketClassification, severity: SupportSeverity): boolean {
  return classification === 'security_issue' || severity === 'P1';
}
