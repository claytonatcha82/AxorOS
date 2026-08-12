export type OperationsExceptionSeverity = 'routine' | 'warning' | 'escalation' | 'critical';

export type OperationsExceptionAction =
  | 'record_complete'
  | 'adjust_workflow'
  | 'notify_executive_agent'
  | 'notify_human_executive';

export function operationsExceptionAction(severity: OperationsExceptionSeverity): OperationsExceptionAction {
  switch (severity) {
    case 'routine': return 'record_complete';
    case 'warning': return 'adjust_workflow';
    case 'escalation': return 'notify_executive_agent';
    case 'critical': return 'notify_human_executive';
  }
}

export interface ProductionStartGate {
  contractSigned: boolean;
  depositConfirmed: boolean;
  onboardingComplete: boolean;
  assetsReceived: boolean;
  planningComplete: boolean;
}

export function productionMayStart(gate: ProductionStartGate): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!gate.contractSigned) missing.push('contractSigned');
  if (!gate.depositConfirmed) missing.push('depositConfirmed');
  if (!gate.onboardingComplete) missing.push('onboardingComplete');
  if (!gate.assetsReceived) missing.push('assetsReceived');
  if (!gate.planningComplete) missing.push('planningComplete');
  return { allowed: missing.length === 0, missing };
}

export interface QualityGate {
  productionComplete: boolean;
  internalQaRequired: boolean;
  internalQaPassed: boolean;
  clientReviewReady: boolean;
}

export function qualityGateDecision(gate: QualityGate): 'wait' | 'rework' | 'client_review' {
  if (!gate.productionComplete) return 'wait';
  if (gate.internalQaRequired && !gate.internalQaPassed) return 'rework';
  if (!gate.clientReviewReady) return 'wait';
  return 'client_review';
}

export type CriticalIssue = 'security' | 'legal' | 'financial' | 'major_client';

export function criticalIssueSeverity(_issue: CriticalIssue): OperationsExceptionSeverity {
  return 'critical';
}
