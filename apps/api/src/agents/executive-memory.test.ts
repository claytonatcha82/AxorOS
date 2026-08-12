import assert from 'node:assert/strict';
import test from 'node:test';
import { temporaryContextMayBecomePermanentPolicy, validateExecutiveDecisionMemory } from './executive-memory.js';

test('executive decision memory requires rationale and expected outcome', () => {
  assert.deepEqual(validateExecutiveDecisionMemory({
    decisionId: 'decision-001', decision: 'Prioritise proposal follow-ups', rationale: 'Highest near-term revenue impact',
    expectedOutcome: 'Improve qualified lead conversion', approvedBy: 'policy', decidedAt: '2026-08-12T18:00:00+02:00',
  }), []);

  const errors = validateExecutiveDecisionMemory({
    decisionId: '', decision: '', rationale: '', expectedOutcome: '', approvedBy: 'policy', decidedAt: '',
  });
  assert.ok(errors.includes('decisionId is required.'));
  assert.ok(errors.includes('rationale is required.'));
});

test('temporary executive context cannot silently become permanent policy', () => {
  assert.equal(temporaryContextMayBecomePermanentPolicy(false), false);
  assert.equal(temporaryContextMayBecomePermanentPolicy(true), true);
});
