import assert from 'node:assert/strict';
import test from 'node:test';
import { executiveControlObjective, validateExecutiveKpis } from './executive-kpis.js';

test('executive KPI snapshot validates healthy values', () => {
  const snapshot = {
    strategicGoalCompletion: 0.8,
    recommendationAcceptanceRate: 0.75,
    recommendationSuccessRate: 0.7,
    missedCriticalEventRate: 0,
    falseEscalationRate: 0.05,
    priorityAccuracy: 0.85,
    averageHumanDecisionsPerCycle: 3,
    crossAgentAlignment: 0.9,
    costPerExecutiveCycle: 12,
  };
  assert.deepEqual(validateExecutiveKpis(snapshot), []);
  assert.deepEqual(executiveControlObjective(snapshot), { reducingRoutineHumanLoad: true, preservingControl: true });
});

test('executive KPI governance rejects invalid rates and costs', () => {
  const errors = validateExecutiveKpis({
    strategicGoalCompletion: 1.2,
    recommendationAcceptanceRate: -0.1,
    recommendationSuccessRate: 0.5,
    missedCriticalEventRate: 0,
    falseEscalationRate: 0.2,
    priorityAccuracy: 0.8,
    averageHumanDecisionsPerCycle: -1,
    crossAgentAlignment: 0.9,
    costPerExecutiveCycle: -5,
  });
  assert.ok(errors.length >= 4);
});
