import type { RuntimeExecutionOutcome } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
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
  store: Pick<AgentRuntimeStore, 'getExecution' | 'listPendingHumanApprovals' | 'listRecoveryRequiredExecutions'>;
  orchestrator: PilotRuntimeOperatorOrchestrator;
}

export interface PilotPendingApproval {
  executionId: string;
  destinationAgent: string;
  objective: string;
  expectedOutput: string;
  capabilityId: string;
  persistedAt: string;
  reason?: string;
}

export interface PilotRecoveryItem {
  executionId: string;
  destinationAgent: string;
  objective: string;
  status: 'review' | 'escalated';
  owner: string;
  nextAction: string;
  priority: string;
  risks: readonly string[];
  persistedAt: string;
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

function pendingApproval(record: AgentRuntimeExecutionRecord): PilotPendingApproval | null {
  const context = record.task.context as Record<string, unknown>;
  let capabilityId: string | undefined;
  let policy: unknown;

  if (record.task.destinationAgent === 'support_agent' && context.supportEmailApprovalPolicy) {
    capabilityId = SUPPORT_EMAIL_DRAFT_CAPABILITY;
    policy = context.supportEmailApprovalPolicy;
  } else if (record.task.destinationAgent === 'marketing_agent' && context.marketingEmailApprovalPolicy) {
    capabilityId = MARKETING_EMAIL_DRAFT_CAPABILITY;
    policy = context.marketingEmailApprovalPolicy;
  } else if (record.task.destinationAgent === 'operations_agent' && context.operationsEmailApprovalPolicy) {
    capabilityId = OPERATIONS_EMAIL_DRAFT_CAPABILITY;
    policy = context.operationsEmailApprovalPolicy;
  }

  if (!capabilityId || !PILOT_OPERATOR_CAPABILITIES.get(record.task.destinationAgent)?.has(capabilityId)) return null;
  const reason = policy && typeof policy === 'object' && !Array.isArray(policy)
    ? (policy as Record<string, unknown>).reason
    : undefined;

  return {
    executionId: record.task.executionId,
    destinationAgent: record.task.destinationAgent,
    objective: record.task.objective,
    expectedOutput: record.task.expectedOutput,
    capabilityId,
    persistedAt: record.persistedAt,
    ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {}),
  };
}

export function createPilotRuntimeOperatorCommand(
  dependencies: PilotRuntimeOperatorCommandDependencies,
) {
  return {
    async listPendingApprovals(limit = 25): Promise<readonly PilotPendingApproval[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('pending approval limit must be an integer from 1 to 50.');
      }
      if (!dependencies.store.listPendingHumanApprovals) {
        throw new Error('pending Human Executive approval listing is not configured.');
      }
      const records = await dependencies.store.listPendingHumanApprovals(limit);
      return records.map(pendingApproval).filter((item): item is PilotPendingApproval => item !== null);
    },

    async listRecoveryRequired(limit = 25): Promise<readonly PilotRecoveryItem[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('recovery queue limit must be an integer from 1 to 50.');
      }
      if (!dependencies.store.listRecoveryRequiredExecutions) {
        throw new Error('runtime recovery queue listing is not configured.');
      }
      const records = await dependencies.store.listRecoveryRequiredExecutions(limit);
      return records.map((record) => ({
        executionId: record.task.executionId,
        destinationAgent: record.task.destinationAgent,
        objective: record.task.objective,
        status: record.task.status as 'review' | 'escalated',
        owner: record.task.approvalOwner ?? 'operations_agent',
        nextAction: record.task.nextAction,
        priority: record.task.priority,
        risks: record.task.risks,
        persistedAt: record.persistedAt,
      }));
    },

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
