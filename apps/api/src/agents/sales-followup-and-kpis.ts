export type SalesFollowUpStep = 'initial' | 'follow_up_1' | 'follow_up_2' | 'final_follow_up';

export const SALES_FOLLOW_UP_CADENCE_DAYS: Record<SalesFollowUpStep, readonly number[]> = {
  initial: [0],
  follow_up_1: [3, 4],
  follow_up_2: [7, 8],
  final_follow_up: [14],
};

export interface SalesFollowUpContext {
  step: SalesFollowUpStep;
  daysSinceInitialContact: number;
  optedOut: boolean;
  doNotContact: boolean;
  duplicateDetected: boolean;
  activeConversation: boolean;
}

export interface SalesFollowUpDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateSalesFollowUp(context: SalesFollowUpContext): SalesFollowUpDecision {
  const reasons: string[] = [];
  if (context.optedOut || context.doNotContact) reasons.push('prospect is do-not-contact.');
  if (context.duplicateDetected) reasons.push('duplicate outreach detected.');
  if (context.activeConversation && context.step !== 'initial') reasons.push('active conversation must be handled contextually rather than by scheduled follow-up.');

  const allowedDays = SALES_FOLLOW_UP_CADENCE_DAYS[context.step];
  if (!allowedDays.includes(context.daysSinceInitialContact)) reasons.push('follow-up is outside the approved cadence window.');

  return { allowed: reasons.length === 0, reasons };
}

export type SalesEscalationReason =
  | 'discount_requested'
  | 'custom_pricing'
  | 'unusual_payment_schedule'
  | 'contract_deviation'
  | 'impossible_deadline'
  | 'high_risk_commitment'
  | 'technical_feasibility_concern';

export function salesEscalationTarget(reason: SalesEscalationReason): 'human_executive' | 'operations' | 'production' {
  if (reason === 'technical_feasibility_concern' || reason === 'impossible_deadline') return 'production';
  if (reason === 'contract_deviation' || reason === 'high_risk_commitment') return 'human_executive';
  return 'operations';
}

export interface SalesKpiSnapshot {
  qualifiedLeads: number;
  positiveReplies: number;
  discoveriesBooked: number;
  proposalsSent: number;
  wonDeals: number;
  revenue: number;
  salesAgentCost: number;
}

export interface SalesKpis {
  qualifiedLeadToPayingClientConversion: number;
  positiveReplyRate: number;
  discoveryBookingRate: number;
  proposalToWinRate: number;
  grossRevenuePerSalesAgentCost: number | null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateSalesKpis(snapshot: SalesKpiSnapshot): SalesKpis {
  return {
    qualifiedLeadToPayingClientConversion: ratio(snapshot.wonDeals, snapshot.qualifiedLeads),
    positiveReplyRate: ratio(snapshot.positiveReplies, snapshot.qualifiedLeads),
    discoveryBookingRate: ratio(snapshot.discoveriesBooked, snapshot.qualifiedLeads),
    proposalToWinRate: ratio(snapshot.wonDeals, snapshot.proposalsSent),
    grossRevenuePerSalesAgentCost: snapshot.salesAgentCost > 0 ? snapshot.revenue / snapshot.salesAgentCost : null,
  };
}
