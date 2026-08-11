export interface ExecutivePriorityInput {
  id: string;
  title: string;
  strategicAlignment: number;
  clientImpact: number;
  revenueImpact: number;
  urgency: number;
  riskReduction: number;
  operationalLeverage: number;
  effort: number;
  risk: number;
}

export interface ExecutivePriorityResult extends ExecutivePriorityInput {
  score: number;
}

export interface ExecutiveObjectives {
  primaryObjectives: string[];
  secondaryObjectives: string[];
}

const FACTOR_MIN = 1;
const FACTOR_MAX = 5;

function assertFactor(name: string, value: number): void {
  if (!Number.isInteger(value) || value < FACTOR_MIN || value > FACTOR_MAX) {
    throw new Error(`${name} must be an integer between 1 and 5.`);
  }
}

export function scoreExecutivePriority(input: ExecutivePriorityInput): ExecutivePriorityResult {
  const factors: Array<[string, number]> = [
    ['strategicAlignment', input.strategicAlignment], ['clientImpact', input.clientImpact],
    ['revenueImpact', input.revenueImpact], ['urgency', input.urgency],
    ['riskReduction', input.riskReduction], ['operationalLeverage', input.operationalLeverage],
    ['effort', input.effort], ['risk', input.risk],
  ];
  for (const [name, value] of factors) assertFactor(name, value);

  const score = input.strategicAlignment + input.clientImpact + input.revenueImpact + input.urgency
    + input.riskReduction + input.operationalLeverage - input.effort - input.risk;
  return { ...input, score };
}

export function rankExecutivePriorities(inputs: ExecutivePriorityInput[]): ExecutivePriorityResult[] {
  return inputs.map(scoreExecutivePriority).sort((a, b) => b.score - a.score);
}

export function validateExecutiveObjectives(objectives: ExecutiveObjectives): string[] {
  const errors: string[] = [];
  if (objectives.primaryObjectives.length === 0) errors.push('at least one primary objective is required.');
  if (objectives.primaryObjectives.some((item) => !item.trim())) errors.push('primary objectives cannot be blank.');
  if (objectives.secondaryObjectives.some((item) => !item.trim())) errors.push('secondary objectives cannot be blank.');
  return errors;
}

export function objectiveChangeRequiresHumanApproval(current: ExecutiveObjectives, proposed: ExecutiveObjectives): boolean {
  return JSON.stringify(current.primaryObjectives) !== JSON.stringify(proposed.primaryObjectives);
}
