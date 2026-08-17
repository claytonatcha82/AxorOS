import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export interface MarketingEmailApprovalDecision {
  approvalRequired: boolean;
  approvalOwner?: 'human_executive';
  reason: string;
}

export function evaluateMarketingEmailApproval(task: AgentRuntimeTask): MarketingEmailApprovalDecision {
  if (task.destinationAgent !== 'marketing_agent') {
    throw new Error('Marketing email approval policy requires destinationAgent marketing_agent.');
  }

  if (task.context.testOnly === true) {
    return {
      approvalRequired: false,
      reason: 'Synthetic development-only Marketing draft may be created without human approval because no real external recipient, mailing list, or campaign is involved.',
    };
  }

  return {
    approvalRequired: true,
    approvalOwner: 'human_executive',
    reason: 'Marketing Stage 1 operates as a Marketing Copilot; any non-test external Marketing communication requires Human Executive approval before provider draft creation.',
  };
}
