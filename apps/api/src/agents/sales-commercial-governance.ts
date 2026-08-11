export interface SalesDiscoveryBrief {
  company: string;
  contact: string;
  knownBusinessContext: string[];
  knownPainPoints: string[];
  assumptionsToValidate: string[];
  recommendedQuestions: string[];
  potentialServices: string[];
  commercialRisks: string[];
  desiredOutcome: string;
}

export interface SalesDiscoverySummary {
  objectives: string[];
  painPoints: string[];
  requirements: string[];
  constraints: string[];
  budgetNotes: string[];
  timeline: string;
  stakeholders: string[];
  risks: string[];
  openQuestions: string[];
  recommendedSolution: string;
  nextAction: string;
}

export interface SalesProposalDraft {
  proposalId: string;
  client: string;
  opportunityId: string;
  businessProblem: string;
  recommendedSolution: string;
  scope: string[];
  deliverables: string[];
  timeline: string;
  investment: number;
  currency: string;
  paymentSchedule: string[];
  optionalServices: string[];
  assumptions: string[];
  exclusions: string[];
  nextSteps: string[];
  approvalStatus: 'draft' | 'approved';
  legalTermsModified: boolean;
}

export type SalesCommercialAction =
  | 'approved_package_pricing'
  | 'approved_add_on_pricing'
  | 'approved_payment_structure'
  | 'discount'
  | 'custom_pricing_outside_threshold'
  | 'unusual_payment_schedule'
  | 'free_additional_work'
  | 'strategic_partnership_pricing'
  | 'permanent_pricing_change'
  | 'major_contract_deviation'
  | 'high_risk_commercial_commitment';

export type SalesCommercialAuthority = 'autonomous' | 'approval_required' | 'human_only';

const COMMERCIAL_AUTHORITY: Record<SalesCommercialAction, SalesCommercialAuthority> = {
  approved_package_pricing: 'autonomous',
  approved_add_on_pricing: 'autonomous',
  approved_payment_structure: 'autonomous',
  discount: 'approval_required',
  custom_pricing_outside_threshold: 'approval_required',
  unusual_payment_schedule: 'approval_required',
  free_additional_work: 'approval_required',
  strategic_partnership_pricing: 'approval_required',
  permanent_pricing_change: 'human_only',
  major_contract_deviation: 'human_only',
  high_risk_commercial_commitment: 'human_only',
};

export interface DiscountAssessment {
  status: 'approval_required';
  autonomousDiscountAllowed: false;
  requiredSequence: readonly ['understand_objection', 'clarify_value', 'adjust_scope_if_appropriate', 'offer_approved_payment_structure_if_applicable', 'escalate_discount_if_justified'];
}

export function getSalesCommercialAuthority(action: SalesCommercialAction): SalesCommercialAuthority {
  return COMMERCIAL_AUTHORITY[action];
}

export function assessDiscountRequest(): DiscountAssessment {
  return {
    status: 'approval_required',
    autonomousDiscountAllowed: false,
    requiredSequence: [
      'understand_objection',
      'clarify_value',
      'adjust_scope_if_appropriate',
      'offer_approved_payment_structure_if_applicable',
      'escalate_discount_if_justified',
    ],
  };
}

export function validateSalesProposalDraft(proposal: SalesProposalDraft): string[] {
  const errors: string[] = [];
  if (!proposal.proposalId.trim()) errors.push('proposalId is required.');
  if (!proposal.client.trim()) errors.push('client is required.');
  if (!proposal.opportunityId.trim()) errors.push('opportunityId is required.');
  if (!proposal.businessProblem.trim()) errors.push('businessProblem is required.');
  if (!proposal.recommendedSolution.trim()) errors.push('recommendedSolution is required.');
  if (proposal.scope.length === 0) errors.push('scope is required.');
  if (proposal.deliverables.length === 0) errors.push('deliverables are required.');
  if (!proposal.timeline.trim()) errors.push('timeline is required.');
  if (!Number.isFinite(proposal.investment) || proposal.investment < 0) errors.push('investment must be a non-negative number.');
  if (!proposal.currency.trim()) errors.push('currency is required.');
  if (proposal.paymentSchedule.length === 0) errors.push('paymentSchedule is required.');
  if (proposal.legalTermsModified) errors.push('Sales Agent may not modify legal terms independently.');
  return errors;
}

export function proposalCanBeSent(proposal: SalesProposalDraft): boolean {
  return validateSalesProposalDraft(proposal).length === 0 && proposal.approvalStatus === 'approved';
}
