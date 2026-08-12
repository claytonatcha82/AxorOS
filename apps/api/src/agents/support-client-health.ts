export interface ClientHealthFactors {
  supportTicketTrend: number;
  websiteHealth: number;
  paymentStatus: number;
  engagement: number;
  satisfaction: number;
  contractRenewal: number;
  performance: number;
}

export function clientHealthScore(factors: ClientHealthFactors): number {
  const values = Object.values(factors);
  if (values.some((value) => value < 0 || value > 100)) throw new Error('client health factors must be between 0 and 100.');
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function clientHealthStatus(score: number): 'healthy' | 'stable' | 'attention' | 'at_risk' {
  if (score < 0 || score > 100) throw new Error('client health score must be between 0 and 100.');
  if (score >= 90) return 'healthy';
  if (score >= 75) return 'stable';
  if (score >= 60) return 'attention';
  return 'at_risk';
}

export interface ExpansionSignal {
  clientId: string;
  observedNeed: string;
  evidence: string[];
  recommendedService: string;
  urgency: 'low' | 'medium' | 'high';
  estimatedValueCategory: 'small' | 'medium' | 'large' | 'unknown';
  salesFollowupRecommended: boolean;
}

export function validateExpansionSignal(signal: ExpansionSignal): string[] {
  const errors: string[] = [];
  if (!signal.clientId.trim()) errors.push('clientId is required.');
  if (!signal.observedNeed.trim()) errors.push('observedNeed is required.');
  if (signal.evidence.length === 0) errors.push('expansion evidence is required.');
  if (!signal.recommendedService.trim()) errors.push('recommendedService is required.');
  return errors;
}

export function recurringIncidentAction(sameRootCauseCount: number): 'normal_resolution' | 'production_root_cause_escalation' {
  if (!Number.isInteger(sameRootCauseCount) || sameRootCauseCount < 1) throw new Error('incident count must be a positive integer.');
  return sameRootCauseCount >= 2 ? 'production_root_cause_escalation' : 'normal_resolution';
}
