import type { AgentExecutionStatus } from './agent-runtime-contract.js';

const transitions: Record<AgentExecutionStatus, readonly AgentExecutionStatus[]> = {
  queued: ['ready', 'cancelled'],
  ready: ['in_progress', 'review', 'blocked', 'cancelled', 'escalated'],
  in_progress: ['waiting', 'review', 'completed', 'blocked', 'failed', 'escalated'],
  waiting: ['ready', 'in_progress', 'blocked', 'failed', 'escalated', 'cancelled'],
  review: ['ready', 'completed', 'in_progress', 'blocked', 'escalated'],
  completed: [],
  blocked: ['ready', 'cancelled', 'escalated'],
  failed: ['ready', 'escalated', 'cancelled'],
  cancelled: [],
  escalated: ['waiting', 'review', 'completed', 'cancelled'],
};

export function canTransitionAgentExecution(from: AgentExecutionStatus, to: AgentExecutionStatus): boolean {
  return transitions[from].includes(to);
}

export function runtimeRetryRoute(attempt: number, highRisk: boolean): 'retry_same' | 'retry_alternative' | 'escalate' {
  if (highRisk) return 'escalate';
  if (attempt <= 1) return 'retry_same';
  if (attempt === 2) return 'retry_alternative';
  return 'escalate';
}

export function requiresHumanOrExecutiveReview(status: AgentExecutionStatus): boolean {
  return status === 'review' || status === 'escalated';
}
