export interface ExecutiveBusinessState {
  reportingPeriod: string;
  revenueSummary: string;
  salesPipelineSummary: string;
  activeProjectsSummary: string;
  supportHealthSummary: string;
  marketingPerformanceSummary: string;
  cashFlowSummary: string;
  automationHealthSummary: string;
  risks: string[];
  opportunities: string[];
  pendingApprovals: string[];
  missedTargets: string[];
}

export interface ExecutiveBusinessStateValidation {
  valid: boolean;
  missingFields: Array<keyof ExecutiveBusinessState>;
}

const REQUIRED_TEXT_FIELDS: Array<keyof ExecutiveBusinessState> = [
  'reportingPeriod',
  'revenueSummary',
  'salesPipelineSummary',
  'activeProjectsSummary',
  'supportHealthSummary',
  'marketingPerformanceSummary',
  'cashFlowSummary',
  'automationHealthSummary',
];

export function validateExecutiveBusinessState(state: ExecutiveBusinessState): ExecutiveBusinessStateValidation {
  const missingFields: Array<keyof ExecutiveBusinessState> = [];
  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = state[field];
    if (typeof value !== 'string' || value.trim().length === 0) missingFields.push(field);
  }
  return { valid: missingFields.length === 0, missingFields };
}
