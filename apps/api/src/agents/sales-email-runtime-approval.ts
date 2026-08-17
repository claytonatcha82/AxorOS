import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateSalesEmailApproval } from './sales-email-approval-policy.js';

export function applySalesEmailRuntimeApprovalPolicy(task: AgentRuntimeTask): AgentRuntimeTask {
  if (task.destinationAgent !== 'sales_agent') {
    throw new Error('Sales email runtime approval policy requires destinationAgent sales_agent.');
  }

  const decision = evaluateSalesEmailApproval(task);
  if (!decision.approvalRequired) return task;

  return {
    ...task,
    approvalRequired: true,
    approvalOwner: decision.approvalOwner,
    nextAction: 'obtain_required_approval',
    context: {
      ...task.context,
      salesEmailApprovalPolicy: {
        stage: 1,
        source: 'atlas_os',
        reason: decision.reason,
      },
    },
  };
}
