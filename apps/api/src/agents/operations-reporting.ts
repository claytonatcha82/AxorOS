export interface OperationsSummary {
  summaryId: string;
  reportingPeriod: string;
  completed: string[];
  inProgress: string[];
  blocked: Array<{ task: string; reason: string; owner: string }>;
  escalated: Array<{ task: string; reason: string; destination: 'executive_agent' | 'human_executive' }>;
  overdue: Array<{ task: string; deadline: string }>;
  capacityWarnings: Array<{ functionName: string; loadPercent: number }>;
  nextActions: string[];
}

export interface OperationsKpis {
  taskCompletionRate: number;
  onTimeCompletionRate: number;
  workflowFailureRate: number;
  averageTaskLatencyMs: number;
  blockedTaskRate: number;
  humanInterventionRate: number;
  retryRate: number;
  crossAgentHandoffSuccessRate: number;
  qaFailureRate: number;
  costPerCompletedWorkflow: number;
}

export function validateOperationsSummary(summary: OperationsSummary): string[] {
  const errors: string[] = [];
  if (!summary.summaryId.trim()) errors.push('summaryId is required.');
  if (!summary.reportingPeriod.trim()) errors.push('reportingPeriod is required.');
  if (summary.nextActions.some((item) => !item.trim())) errors.push('nextActions cannot contain blank items.');
  return errors;
}

export function validateOperationsKpis(kpis: OperationsKpis): string[] {
  const errors: string[] = [];
  const rates: Array<[string, number]> = [
    ['taskCompletionRate', kpis.taskCompletionRate], ['onTimeCompletionRate', kpis.onTimeCompletionRate],
    ['workflowFailureRate', kpis.workflowFailureRate], ['blockedTaskRate', kpis.blockedTaskRate],
    ['humanInterventionRate', kpis.humanInterventionRate], ['retryRate', kpis.retryRate],
    ['crossAgentHandoffSuccessRate', kpis.crossAgentHandoffSuccessRate], ['qaFailureRate', kpis.qaFailureRate],
  ];
  for (const [name, value] of rates) if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  if (kpis.averageTaskLatencyMs < 0) errors.push('averageTaskLatencyMs cannot be negative.');
  if (kpis.costPerCompletedWorkflow < 0) errors.push('costPerCompletedWorkflow cannot be negative.');
  return errors;
}

export function humanInterventionTrend(previous: number, current: number): 'improving' | 'stable' | 'worsening' {
  if (current < previous) return 'improving';
  if (current > previous) return 'worsening';
  return 'stable';
}
