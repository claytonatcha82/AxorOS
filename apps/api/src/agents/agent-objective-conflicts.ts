import type { CoreAgentId } from './agent-objectives.js';

export interface AgentObjectiveConflict {
  conflictId: string;
  agents: CoreAgentId[];
  description: string;
  businessImpact: 'low' | 'medium' | 'high' | 'critical';
  evidenceReferences: string[];
  recommendedResolution: string;
  escalationRequired: boolean;
}

export function validateObjectiveConflict(conflict: AgentObjectiveConflict): string[] {
  const errors: string[] = [];
  if (!conflict.conflictId.trim()) errors.push('conflictId is required.');
  if (conflict.agents.length < 2) errors.push('objective conflict must involve at least two agents.');
  if (new Set(conflict.agents).size !== conflict.agents.length) errors.push('objective conflict agents must be unique.');
  if (!conflict.description.trim()) errors.push('conflict description is required.');
  if (conflict.evidenceReferences.length === 0) errors.push('objective conflict requires evidence.');
  if (!conflict.recommendedResolution.trim()) errors.push('recommendedResolution is required.');
  if ((conflict.businessImpact === 'high' || conflict.businessImpact === 'critical') && !conflict.escalationRequired) errors.push('high-impact objective conflicts require escalation.');
  return errors;
}

export function objectiveConflictRoute(conflict: AgentObjectiveConflict): 'operations' | 'executive' | 'human_executive' {
  if (conflict.businessImpact === 'critical') return 'human_executive';
  if (conflict.businessImpact === 'high') return 'executive';
  return 'operations';
}
