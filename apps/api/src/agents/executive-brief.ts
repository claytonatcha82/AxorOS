export type ExecutiveBusinessHealth = 'healthy' | 'watch' | 'at_risk' | 'critical';
export type ExecutiveRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ExecutiveBrief {
  executiveBriefId: string;
  reportingPeriod: string;
  businessHealth: { overallStatus: ExecutiveBusinessHealth; confidence: number };
  topPriorities: Array<{ priority: string; reason: string; owner: string; expectedOutcome: string }>;
  criticalRisks: Array<{ risk: string; severity: ExecutiveRiskSeverity; recommendation: string }>;
  opportunities: Array<{ opportunity: string; estimatedValue: string; recommendedAction: string }>;
  humanDecisionsRequired: Array<{ decision: string; deadline: string; options: string[]; recommendation: string }>;
  operationsInstructions: Array<{ task: string; priority: 'low' | 'medium' | 'high' | 'critical'; assignedFunction: string }>;
}

export type ExecutiveEscalationType =
  | 'critical_financial_risk'
  | 'legal_risk'
  | 'security_breach'
  | 'major_client_dispute'
  | 'system_wide_agent_failure'
  | 'high_value_opportunity'
  | 'material_reputational_issue'
  | 'strategic_objective_at_serious_risk';

export function validateExecutiveBrief(brief: ExecutiveBrief): string[] {
  const errors: string[] = [];
  if (!brief.executiveBriefId.trim()) errors.push('executiveBriefId is required.');
  if (!brief.reportingPeriod.trim()) errors.push('reportingPeriod is required.');
  if (brief.businessHealth.confidence < 0 || brief.businessHealth.confidence > 1) errors.push('business health confidence must be between 0 and 1.');
  if (brief.topPriorities.length === 0) errors.push('at least one top priority is required.');
  for (const decision of brief.humanDecisionsRequired) {
    if (decision.options.length < 2) errors.push('human decisions require at least two options.');
    if (!decision.recommendation.trim()) errors.push('human decisions require a recommendation.');
  }
  return errors;
}

export function requiresImmediateExecutiveEscalation(type: ExecutiveEscalationType): boolean {
  return [
    'critical_financial_risk', 'legal_risk', 'security_breach', 'major_client_dispute',
    'system_wide_agent_failure', 'high_value_opportunity', 'material_reputational_issue',
    'strategic_objective_at_serious_risk',
  ].includes(type);
}
