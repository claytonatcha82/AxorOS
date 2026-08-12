import assert from 'node:assert/strict';
import test from 'node:test';
import { objectiveChangeMayApply, validateQuarterlyObjectiveReview } from './agent-objective-review.js';

test('objective review requires Executive ownership and evidence', () => {
  const errors = validateQuarterlyObjectiveReview({ reviewId: 'r1', agentId: 'lead_agent', periodStart: '2026-07-01', periodEnd: '2026-09-30', reviewedBy: 'executive_agent', objectiveStillValid: true, evidenceReferences: [], observedPerformance: '', conflictsDetected: [], humanApprovalRequired: false, reviewedAt: '2026-10-01T00:00:00Z' });
  assert.ok(errors.includes('objective review requires evidence.'));
  assert.ok(errors.includes('observedPerformance is required.'));
});

test('primary objective changes require explicit human approval', () => {
  const review = { reviewId: 'r2', agentId: 'marketing_agent' as const, periodStart: '2026-07-01', periodEnd: '2026-09-30', reviewedBy: 'executive_agent' as const, objectiveStillValid: false, evidenceReferences: ['kpi://marketing-q3'], observedPerformance: 'Qualified inbound demand no longer reflects approved strategy.', conflictsDetected: [], recommendedChange: 'replace objective', humanApprovalRequired: false, reviewedAt: '2026-10-01T00:00:00Z' };
  assert.ok(validateQuarterlyObjectiveReview(review).includes('changing a primary objective requires human approval.'));
  assert.equal(objectiveChangeMayApply(review), false);
  assert.equal(objectiveChangeMayApply({ ...review, humanApprovalRequired: true }), true);
});
