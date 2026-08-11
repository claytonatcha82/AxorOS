import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExecutiveBusinessState, type ExecutiveBusinessState } from './executive-business-state.js';

function validState(): ExecutiveBusinessState {
  return {
    reportingPeriod: '2026-W32',
    revenueSummary: 'Revenue stable versus target.',
    salesPipelineSummary: 'Three proposal-stage opportunities active.',
    activeProjectsSummary: 'Two projects on track.',
    supportHealthSummary: 'No critical support incidents.',
    marketingPerformanceSummary: 'No intervention required.',
    cashFlowSummary: 'Cash flow healthy for the next 30 days.',
    automationHealthSummary: 'Core automations healthy.',
    risks: ['One project review date at risk'],
    opportunities: ['High-value international lead'],
    pendingApprovals: ['Hosting upgrade approval'],
    missedTargets: [],
  };
}

test('complete consolidated business state is accepted', () => {
  const result = validateExecutiveBusinessState(validState());
  assert.equal(result.valid, true);
  assert.deepEqual(result.missingFields, []);
});

test('executive agent rejects incomplete consolidated state packages', () => {
  const state = validState();
  state.cashFlowSummary = '';
  state.automationHealthSummary = '';
  const result = validateExecutiveBusinessState(state);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingFields, ['cashFlowSummary', 'automationHealthSummary']);
});
