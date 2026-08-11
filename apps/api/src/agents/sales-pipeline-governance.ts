export type SalesPipelineStage =
  | 'qualified'
  | 'contacted'
  | 'replied'
  | 'discovery'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'
  | 'nurture';

export const SALES_PIPELINE_TRANSITIONS: Record<SalesPipelineStage, readonly SalesPipelineStage[]> = {
  qualified: ['contacted', 'nurture', 'lost'],
  contacted: ['replied', 'nurture', 'lost'],
  replied: ['discovery', 'nurture', 'lost'],
  discovery: ['proposal', 'nurture', 'lost'],
  proposal: ['negotiation', 'won', 'nurture', 'lost'],
  negotiation: ['won', 'nurture', 'lost'],
  won: [],
  lost: [],
  nurture: ['contacted', 'replied', 'discovery', 'lost'],
};

export function canTransitionSalesStage(from: SalesPipelineStage, to: SalesPipelineStage): boolean {
  return SALES_PIPELINE_TRANSITIONS[from].includes(to);
}

export interface SalesNurtureRecord {
  reason: 'not_now' | 'budget_timing' | 'internal_delay' | 'future_project' | 'other';
  followUpAt: string;
  notes: string;
  optedOut: boolean;
}

export function validateSalesNurtureRecord(record: SalesNurtureRecord): string[] {
  const errors: string[] = [];
  if (record.optedOut) errors.push('opted-out prospects cannot enter nurture mode.');
  if (!record.followUpAt.trim()) errors.push('followUpAt is required.');
  if (!record.notes.trim()) errors.push('nurture notes are required.');
  return errors;
}

export type LostDealReason =
  | 'price'
  | 'timing'
  | 'competitor'
  | 'no_decision'
  | 'scope_mismatch'
  | 'trust'
  | 'unresponsive'
  | 'other';

export interface LostDealRecord {
  reason: LostDealReason;
  detail: string;
  competitor?: string;
  reusableLearning?: string;
}

export function validateLostDealRecord(record: LostDealRecord): string[] {
  const errors: string[] = [];
  if (!record.detail.trim()) errors.push('lost-deal detail is required.');
  if (record.reason === 'competitor' && !record.competitor?.trim()) errors.push('competitor name or description is required for competitor losses.');
  return errors;
}

export interface SalesProductionHandover {
  clientId: string;
  projectId: string;
  proposalAccepted: boolean;
  contractSigned: boolean;
  requiredPaymentConfirmed: boolean;
  onboardingComplete: boolean;
  approvedScope: string[];
  deliverables: string[];
  excludedScope: string[];
  timeline: string;
  milestones: string[];
  clientExpectations: string[];
  knownRisks: string[];
  openItems: string[];
}

export interface SalesProductionHandoverResult {
  ready: boolean;
  missingRequirements: string[];
}

export function validateSalesProductionHandover(handover: SalesProductionHandover): SalesProductionHandoverResult {
  const missingRequirements: string[] = [];
  if (!handover.clientId.trim()) missingRequirements.push('clientId');
  if (!handover.projectId.trim()) missingRequirements.push('projectId');
  if (!handover.proposalAccepted) missingRequirements.push('proposalAccepted');
  if (!handover.contractSigned) missingRequirements.push('contractSigned');
  if (!handover.requiredPaymentConfirmed) missingRequirements.push('requiredPaymentConfirmed');
  if (!handover.onboardingComplete) missingRequirements.push('onboardingComplete');
  if (handover.approvedScope.length === 0) missingRequirements.push('approvedScope');
  if (handover.deliverables.length === 0) missingRequirements.push('deliverables');
  if (!handover.timeline.trim()) missingRequirements.push('timeline');
  if (handover.milestones.length === 0) missingRequirements.push('milestones');

  return { ready: missingRequirements.length === 0, missingRequirements };
}
