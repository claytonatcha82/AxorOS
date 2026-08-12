export interface ExecutiveKpiSnapshot {
  strategicGoalCompletion: number;
  recommendationAcceptanceRate: number;
  recommendationSuccessRate: number;
  missedCriticalEventRate: number;
  falseEscalationRate: number;
  priorityAccuracy: number;
  averageHumanDecisionsPerCycle: number;
  crossAgentAlignment: number;
  costPerExecutiveCycle: number;
}

export function validateExecutiveKpis(snapshot: ExecutiveKpiSnapshot): string[] {
  const errors: string[] = [];
  const boundedRates: Array<[string, number]> = [
    ['strategicGoalCompletion', snapshot.strategicGoalCompletion],
    ['recommendationAcceptanceRate', snapshot.recommendationAcceptanceRate],
    ['recommendationSuccessRate', snapshot.recommendationSuccessRate],
    ['missedCriticalEventRate', snapshot.missedCriticalEventRate],
    ['falseEscalationRate', snapshot.falseEscalationRate],
    ['priorityAccuracy', snapshot.priorityAccuracy],
    ['crossAgentAlignment', snapshot.crossAgentAlignment],
  ];

  for (const [name, value] of boundedRates) {
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  }
  if (!Number.isFinite(snapshot.averageHumanDecisionsPerCycle) || snapshot.averageHumanDecisionsPerCycle < 0) {
    errors.push('averageHumanDecisionsPerCycle must be zero or greater.');
  }
  if (!Number.isFinite(snapshot.costPerExecutiveCycle) || snapshot.costPerExecutiveCycle < 0) {
    errors.push('costPerExecutiveCycle must be zero or greater.');
  }
  return errors;
}

export function executiveControlObjective(snapshot: ExecutiveKpiSnapshot): {
  reducingRoutineHumanLoad: boolean;
  preservingControl: boolean;
} {
  return {
    reducingRoutineHumanLoad: snapshot.averageHumanDecisionsPerCycle <= 5,
    preservingControl: snapshot.missedCriticalEventRate === 0 && snapshot.falseEscalationRate <= 0.1,
  };
}
