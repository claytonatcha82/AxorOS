import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresImmediateExecutiveEscalation, validateExecutiveBrief, type ExecutiveBrief } from './executive-brief.js';

function validBrief(): ExecutiveBrief {
  return {
    executiveBriefId: 'brief-2026-w32', reportingPeriod: '2026-W32',
    businessHealth: { overallStatus: 'watch', confidence: 0.9 },
    topPriorities: [{ priority: 'Close proposal-stage opportunities', reason: 'Highest near-term revenue impact', owner: 'Sales', expectedOutcome: 'Convert qualified pipeline' }],
    criticalRisks: [{ risk: 'Production capacity constraint', severity: 'high', recommendation: 'Protect quality and rebalance delivery dates' }],
    opportunities: [{ opportunity: 'International qualified lead', estimatedValue: 'TBD after discovery', recommendedAction: 'Assess commercial and operational fit' }],
    humanDecisionsRequired: [{ decision: 'Approve material tool purchase', deadline: '2026-08-14', options: ['Approve', 'Reject', 'Request alternative'], recommendation: 'Compare ROI and cheaper alternatives first' }],
    operationsInstructions: [{ task: 'Coordinate proposal follow-ups', priority: 'high', assignedFunction: 'sales' }],
  };
}

test('complete executive brief is accepted', () => {
  assert.deepEqual(validateExecutiveBrief(validBrief()), []);
});

test('executive brief rejects weak human decision packages', () => {
  const brief = validBrief();
  brief.humanDecisionsRequired[0]!.options = ['Approve'];
  brief.humanDecisionsRequired[0]!.recommendation = '';
  const errors = validateExecutiveBrief(brief);
  assert.ok(errors.includes('human decisions require at least two options.'));
  assert.ok(errors.includes('human decisions require a recommendation.'));
});

test('charter-defined critical events always escalate immediately', () => {
  assert.equal(requiresImmediateExecutiveEscalation('critical_financial_risk'), true);
  assert.equal(requiresImmediateExecutiveEscalation('security_breach'), true);
  assert.equal(requiresImmediateExecutiveEscalation('major_client_dispute'), true);
  assert.equal(requiresImmediateExecutiveEscalation('system_wide_agent_failure'), true);
  assert.equal(requiresImmediateExecutiveEscalation('high_value_opportunity'), true);
  assert.equal(requiresImmediateExecutiveEscalation('strategic_objective_at_serious_risk'), true);
});
