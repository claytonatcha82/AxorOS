import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateFinanceEmailApproval } from './finance-email-approval-policy.js';

export function applyFinanceEmailRuntimeApprovalPolicy(task: AgentRuntimeTask): AgentRuntimeTask {
  if (task.destinationAgent !== 'finance_agent') {
    throw new Error('Finance email runtime approval policy requires destinationAgent finance_agent.');
  }

  const decision = evaluateFinanceEmailApproval(task);
  if (!decision.approvalRequired) return task;
  if (!decision.approvalOwner) {
    throw new Error('Finance email approval policy requires an approval owner when approval is required.');
  }

  return {
    ...task,
    approvalRequired: true,
    approvalOwner: decision.approvalOwner,
    nextAction: 'obtain_required_approval',
    context: {
      ...task.context,
      financeEmailApprovalPolicy: {
        stage: 1,
        source: 'atlas_os',
        reason: decision.reason,
      },
    },
  };
}
