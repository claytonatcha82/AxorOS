export interface ExecutiveStrategicMemory {
  currentGoals: string[];
  currentPriorities: string[];
  businessConstraints: string[];
  approvedStrategicDecisions: string[];
}

export interface ExecutiveDecisionMemoryRecord {
  decisionId: string;
  decision: string;
  rationale: string;
  expectedOutcome: string;
  actualOutcome?: string;
  approvedBy: 'human_executive' | 'policy';
  decidedAt: string;
}

export interface ExecutiveTemporaryContext {
  reportingPeriod: string;
  currentIncidents: string[];
  currentOpportunities: string[];
}

export function validateExecutiveDecisionMemory(record: ExecutiveDecisionMemoryRecord): string[] {
  const errors: string[] = [];
  if (!record.decisionId.trim()) errors.push('decisionId is required.');
  if (!record.decision.trim()) errors.push('decision is required.');
  if (!record.rationale.trim()) errors.push('rationale is required.');
  if (!record.expectedOutcome.trim()) errors.push('expectedOutcome is required.');
  if (!record.decidedAt.trim()) errors.push('decidedAt is required.');
  return errors;
}

export function temporaryContextMayBecomePermanentPolicy(humanApproved: boolean): boolean {
  return humanApproved;
}
