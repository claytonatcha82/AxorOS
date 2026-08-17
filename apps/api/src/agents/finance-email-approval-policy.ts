import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export interface FinanceEmailApprovalDecision {
  approvalRequired: boolean;
  approvalOwner?: 'human_executive';
  reason: string;
}

export function evaluateFinanceEmailApproval(task: AgentRuntimeTask): FinanceEmailApprovalDecision {
  if (task.destinationAgent !== 'finance_agent') {
    throw new Error('Finance email approval policy requires destinationAgent finance_agent.');
  }

  if (task.context.testOnly === true) {
    return {
      approvalRequired: false,
      reason: 'Synthetic development-only Finance draft may be created without human approval because no external client financial communication is involved.',
    };
  }

  return {
    approvalRequired: true,
    approvalOwner: 'human_executive',
    reason: 'Finance Stage 1 operates as a Finance Copilot; any non-test client-facing financial communication requires Human Executive approval before provider draft creation.',
  };
}
