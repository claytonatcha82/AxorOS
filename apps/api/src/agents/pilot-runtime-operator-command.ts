import type { RuntimeExecutionOutcome } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { EXECUTIVE_STRATEGIC_ANALYSIS_CAPABILITY } from './executive-model-capabilities.js';
import { KNOWLEDGE_SYNTHESIS_CAPABILITY } from './knowledge-model-capabilities.js';
import { MARKETING_EMAIL_DRAFT_CAPABILITY } from './marketing-email-capabilities.js';
import { MARKETING_DRAFT_COPY_CAPABILITY } from './marketing-model-capabilities.js';
import { OPERATIONS_EMAIL_DRAFT_CAPABILITY } from './operations-email-capabilities.js';
import { OPERATIONS_WORKFLOW_REASONING_CAPABILITY } from './operations-model-capabilities.js';
import { SUPPORT_EMAIL_DRAFT_CAPABILITY } from './support-email-capabilities.js';
import { SUPPORT_INCIDENT_ANALYSIS_CAPABILITY } from './support-model-capabilities.js';

export interface PilotRuntimeOperatorOrchestrator {
  execute(input: { executionId: string; capabilityId: string }): Promise<RuntimeExecutionOutcome>;
  resolveApproval(input: {
    executionId: string;
    actor: 'human_executive';
    decision: 'approved' | 'rejected';
    reason?: string;
  }): Promise<RuntimeExecutionOutcome>;
}

export interface PilotRuntimeOperatorCommandDependencies {
  store: Pick<AgentRuntimeStore, 'getExecution'>;
  orchestrator: PilotRuntimeOperatorOrchestrator;
}

const PILOT_OPERATOR_CAPABILITIES = new Map<string, ReadonlySet<string>>([
  ['support_agent', new Set([SUPPORT_INCIDENT_ANALYSIS_CAPABILITY, SUPPORT_EMAIL_DRAFT_CAPABILITY])],
  ['marketing_agent', new Set([MARKETING_DRAFT_COPY_CAPABILITY, MARKETING_EMAIL_DRAFT_CAPABILITY])],
  ['operations_agent', new Set([OPERATIONS_WORKFLOW_REASONING_CAPABILITY, OPERATIONS_EMAIL_DRAFT_CAPABILITY])],
  ['knowledge_agent', new Set([KNOWLEDGE_SYNTHESIS_CAPABILITY])],
  ['executive_agent', new Set([EXECUTIVE_STRATEGIC_ANALYSIS_CAPABILITY])],
]);

function normalizedRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function createPilotRuntimeOperatorCommand(
  dependencies: PilotRuntimeOperatorCommandDependencies,
) {
  return {
    async execute(executionId: string, capabilityId: string): Promise<RuntimeExecutionOutcome> {
      const normalizedExecutionId = normalizedRequired(executionId, 'executionId');
      const normalizedCapabilityId = normalizedRequired(capabilityId, 'capabilityId');
      const record = await dependencies.store.getExecution(normalizedExecutionId);
      if (!record) throw new Error(`runtime execution ${normalizedExecutionId} was not found.`);

      const allowed = PILOT_OPERATOR_CAPABILITIES.get(record.task.destinationAgent);
      if (!allowed?.has(normalizedCapabilityId)) {
        throw new Error(
          `pilot operator cannot execute ${record.task.destinationAgent}:${normalizedCapabilityId}.`,
        );
      }

      return dependencies.orchestrator.execute({
        executionId: normalizedExecutionId,
        capabilityId: normalizedCapabilityId,
      });
    },

    async resolveApproval(
      executionId: string,
      decision: 'approved' | 'rejected',
      reason?: string,
    ): Promise<RuntimeExecutionOutcome> {
      const normalizedExecutionId = normalizedRequired(executionId, 'executionId');
      const record = await dependencies.store.getExecution(normalizedExecutionId);
      if (!record) throw new Error(`runtime execution ${normalizedExecutionId} was not found.`);
      if (!PILOT_OPERATOR_CAPABILITIES.has(record.task.destinationAgent)) {
        throw new Error(`pilot operator cannot resolve approvals for ${record.task.destinationAgent}.`);
      }
      if (record.task.approvalOwner !== 'human_executive') {
        throw new Error('pilot operator can resolve only Human Executive approvals.');
      }

      return dependencies.orchestrator.resolveApproval({
        executionId: normalizedExecutionId,
        actor: 'human_executive',
        decision,
        ...(reason ? { reason } : {}),
      });
    },
  };
}
