import assert from 'node:assert/strict';
import test from 'node:test';
import { objectiveConflictRoute, validateObjectiveConflict } from './agent-objective-conflicts.js';

test('objective conflicts require multiple agents and evidence', () => {
  const errors = validateObjectiveConflict({ conflictId: 'c1', agents: ['sales_agent'], description: '', businessImpact: 'medium', evidenceReferences: [], recommendedResolution: '', escalationRequired: false });
  assert.ok(errors.includes('objective conflict must involve at least two agents.'));
  assert.ok(errors.includes('objective conflict requires evidence.'));
});

test('high and critical objective conflicts escalate beyond routine operations', () => {
  const high = { conflictId: 'c2', agents: ['sales_agent','production_agent'] as const, description: 'Revenue pressure conflicts with profitable delivery.', businessImpact: 'high' as const, evidenceReferences: ['kpi://margin'], recommendedResolution: 'Rebalance commercial scope against margin policy.', escalationRequired: true };
  assert.equal(validateObjectiveConflict({ ...high, agents: [...high.agents] }), []);
  assert.equal(objectiveConflictRoute({ ...high, agents: [...high.agents] }), 'executive');
  assert.equal(objectiveConflictRoute({ ...high, agents: [...high.agents], businessImpact: 'critical' }), 'human_executive');
});
