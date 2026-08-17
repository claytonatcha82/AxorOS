import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export interface SupportEmailApprovalDecision {
  approvalRequired: boolean;
  approvalOwner?: 'human_executive';
  reason: string;
}

export function evaluateSupportEmailApproval(task: AgentRuntimeTask): SupportEmailApprovalDecision {
  if (task.destinationAgent !== 'support_agent') {
    throw new Error('Support email approval policy requires destinationAgent support_agent.');
  }

  if (task.context.testOnly === true) {
    return {
      approvalRequired: false,
      reason: 'Synthetic development-only Support draft may be created without human approval because no external client communication is involved.',
    };
  }

  return {
    approvalRequired: true,
    approvalOwner: 'human_executive',
    reason: 'Support V1 operates as a Support Copilot for reply drafting; external client-facing Support drafts require human executive approval before provider draft creation.',
  };
}
