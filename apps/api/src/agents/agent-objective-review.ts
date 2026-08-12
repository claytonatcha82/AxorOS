import type { CoreAgentId } from './agent-objectives.js';

export interface AgentObjectiveReview {
  reviewId: string;
  agentId: CoreAgentId;
  periodStart: string;
  periodEnd: string;
  reviewedBy: 'executive_agent';
  objectiveStillValid: boolean;
  evidenceReferences: string[];
  observedPerformance: string;
  conflictsDetected: string[];
  recommendedChange?: string;
  humanApprovalRequired: boolean;
  reviewedAt: string;
}

export function validateQuarterlyObjectiveReview(review: AgentObjectiveReview): string[] {
  const errors: string[] = [];
  if (!review.reviewId.trim()) errors.push('reviewId is required.');
  if (review.reviewedBy !== 'executive_agent') errors.push('Executive Agent must own objective review.');
  if (!review.periodStart.trim() || !review.periodEnd.trim()) errors.push('review period is required.');
  if (review.evidenceReferences.length === 0) errors.push('objective review requires evidence.');
  if (!review.observedPerformance.trim()) errors.push('observedPerformance is required.');
  if (review.recommendedChange && !review.humanApprovalRequired) errors.push('changing a primary objective requires human approval.');
  return errors;
}

export function objectiveChangeMayApply(review: AgentObjectiveReview): boolean {
  return Boolean(review.recommendedChange && review.humanApprovalRequired && review.objectiveStillValid === false);
}
