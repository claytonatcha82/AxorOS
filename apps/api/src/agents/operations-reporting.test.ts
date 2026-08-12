import assert from 'node:assert/strict';
import test from 'node:test';
import { humanInterventionTrend, validateOperationsKpis, validateOperationsSummary } from './operations-reporting.js';

test('operations summary supports completed active blocked escalated overdue and capacity views', () => {
  assert.deepEqual(validateOperationsSummary({
    summaryId: 'ops-2026-08-12', reportingPeriod: '2026-08-12', completed: ['lead qualification'], inProgress: ['website build'],
    blocked: [{ task: 'client onboarding', reason: 'assets missing', owner: 'operations' }],
    escalated: [{ task: 'security incident', reason: 'critical risk', destination: 'human_executive' }],
    overdue: [{ task: 'proposal follow-up', deadline: '2026-08-11' }],
    capacityWarnings: [{ functionName: 'production', loadPercent: 94 }], nextActions: ['rebalance production workload'],
  }), []);
});

test('operations KPIs include human intervention and cross-agent handoff quality', () => {
  assert.deepEqual(validateOperationsKpis({
    taskCompletionRate: 0.95, onTimeCompletionRate: 0.92, workflowFailureRate: 0.03, averageTaskLatencyMs: 5000,
    blockedTaskRate: 0.05, humanInterventionRate: 0.08, retryRate: 0.04, crossAgentHandoffSuccessRate: 0.97,
    qaFailureRate: 0.02, costPerCompletedWorkflow: 0.15,
  }), []);
});

test('declining human intervention is reported as improving autonomy', () => {
  assert.equal(humanInterventionTrend(0.15, 0.08), 'improving');
  assert.equal(humanInterventionTrend(0.08, 0.12), 'worsening');
});
