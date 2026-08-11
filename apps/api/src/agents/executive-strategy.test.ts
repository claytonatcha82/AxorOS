import assert from 'node:assert/strict';
import test from 'node:test';
import { objectiveChangeRequiresHumanApproval, rankExecutivePriorities, scoreExecutivePriority, validateExecutiveObjectives } from './executive-strategy.js';

test('executive priorities follow the approved strategic scoring model', () => {
  const ranked = rankExecutivePriorities([
    { id: 'blog', title: 'Publish blog article', strategicAlignment: 3, clientImpact: 2, revenueImpact: 2, urgency: 2, riskReduction: 1, operationalLeverage: 2, effort: 2, risk: 1 },
    { id: 'prospect', title: 'Follow up qualified prospect', strategicAlignment: 5, clientImpact: 5, revenueImpact: 5, urgency: 5, riskReduction: 2, operationalLeverage: 4, effort: 2, risk: 1 },
  ]);
  assert.equal(ranked[0]!.id, 'prospect');
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});

test('priority factors must remain within the approved 1 to 5 scale', () => {
  assert.throws(() => scoreExecutivePriority({ id: 'bad', title: 'Bad', strategicAlignment: 6, clientImpact: 1, revenueImpact: 1, urgency: 1, riskReduction: 1, operationalLeverage: 1, effort: 1, risk: 1 }), /between 1 and 5/);
});

test('executive objectives require at least one valid primary objective', () => {
  assert.deepEqual(validateExecutiveObjectives({ primaryObjectives: ['Acquire first 10 paying clients'], secondaryObjectives: ['Grow SEO presence'] }), []);
  assert.ok(validateExecutiveObjectives({ primaryObjectives: [], secondaryObjectives: [] }).length > 0);
});

test('executive agent cannot silently invent or replace primary objectives', () => {
  const current = { primaryObjectives: ['Acquire first 10 paying clients'], secondaryObjectives: ['Grow SEO presence'] };
  const same = { ...current };
  const changed = { primaryObjectives: ['Launch a new SaaS business'], secondaryObjectives: ['Grow SEO presence'] };
  assert.equal(objectiveChangeRequiresHumanApproval(current, same), false);
  assert.equal(objectiveChangeRequiresHumanApproval(current, changed), true);
});
