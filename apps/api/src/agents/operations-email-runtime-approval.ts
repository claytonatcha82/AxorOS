import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateOperationsEmailApproval } from './operations-email-approval-policy.js';

export function applyOperationsEmailRuntimeApprovalPolicy(task: AgentRuntimeTask): AgentRuntimeTask {
  if (task.destinationAgent !== 'operations_agent') {
    throw new Error('Operations email runtime approval policy requires destinationAgent operations_agent.');
  }

  const decision = evaluateOperationsEmailApproval(task);
  if (!decision.approvalRequired) return task;
  if (!decision.approvalOwner) {
    throw new Error('Operations email approval policy requires an approval owner when approval is required.');
  }

  return {
    ...task,
    approvalRequired: true,
    approvalOwner: decision.approvalOwner,
    nextAction: 'obtain_required_approval',
    context: {
      ...task.context,
      operationsEmailApprovalPolicy: {
        stage: 1,
        source: 'atlas_os',
        reason: decision.reason,
      },
    },
  };
}
