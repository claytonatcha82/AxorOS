import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export interface OperationsEmailApprovalDecision {
  approvalRequired: boolean;
  approvalOwner?: 'human_executive';
  reason: string;
}

export function evaluateOperationsEmailApproval(task: AgentRuntimeTask): OperationsEmailApprovalDecision {
  if (task.destinationAgent !== 'operations_agent') {
    throw new Error('Operations email approval policy requires destinationAgent operations_agent.');
  }

  if (task.context.testOnly === true) {
    return {
      approvalRequired: false,
      reason: 'Synthetic development-only Operations draft may be created without human approval because no real client, prospect, external recipient, operational commitment, payment information, confidential client information, or production action is involved.',
    };
  }

  return {
    approvalRequired: true,
    approvalOwner: 'human_executive',
    reason: 'Operations Stage 1 operates as an Operations Copilot; any non-test external Operations communication requires Human Executive approval before provider draft creation.',
  };
}
