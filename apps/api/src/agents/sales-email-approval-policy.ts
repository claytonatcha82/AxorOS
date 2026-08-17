import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export interface SalesEmailApprovalDecision {
  approvalRequired: boolean;
  approvalOwner?: 'human_executive';
  reason: string;
}

export function evaluateSalesEmailApproval(task: AgentRuntimeTask): SalesEmailApprovalDecision {
  if (task.destinationAgent !== 'sales_agent') {
    throw new Error('Sales email approval policy requires destinationAgent sales_agent.');
  }

  const testOnly = task.context.testOnly === true;
  if (testOnly) {
    return {
      approvalRequired: false,
      reason: 'Synthetic development-only draft may be created without human approval because no external recipient is involved.',
    };
  }

  return {
    approvalRequired: true,
    approvalOwner: 'human_executive',
    reason: 'Any non-test Sales email draft intended for an external prospect or client requires human executive approval before Gmail draft creation.',
  };
}
