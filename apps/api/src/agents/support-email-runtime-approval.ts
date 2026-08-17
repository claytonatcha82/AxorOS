import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateSupportEmailApproval } from './support-email-approval-policy.js';

export function applySupportEmailRuntimeApprovalPolicy(task: AgentRuntimeTask): AgentRuntimeTask {
  if (task.destinationAgent !== 'support_agent') {
    throw new Error('Support email runtime approval policy requires destinationAgent support_agent.');
  }

  const decision = evaluateSupportEmailApproval(task);
  if (!decision.approvalRequired) return task;
  if (!decision.approvalOwner) {
    throw new Error('Support email approval policy requires an approval owner when approval is required.');
  }

  return {
    ...task,
    approvalRequired: true,
    approvalOwner: decision.approvalOwner,
    nextAction: 'obtain_required_approval',
    context: {
      ...task.context,
      supportEmailApprovalPolicy: {
        stage: 1,
        source: 'atlas_os',
        reason: decision.reason,
      },
    },
  };
}
