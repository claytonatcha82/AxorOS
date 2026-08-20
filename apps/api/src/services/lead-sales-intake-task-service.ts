import type { AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import { validateAgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import type { LeadSalesHandoffEligibility } from './lead-sales-handoff-eligibility-service.js';

export interface CreateLeadSalesIntakeTaskInput {
  taskId: string;
  executionId: string;
  correlationId: string;
  eligibilityRecordId: string;
  eligibility: LeadSalesHandoffEligibility;
  createdAt: string;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createLeadSalesIntakeTaskService() {
  return {
    createTask(input: CreateLeadSalesIntakeTaskInput): AgentRuntimeTask {
      if (input.eligibility.eligible !== true) {
        throw new Error('Sales intake requires an eligible Lead to Sales handoff decision.');
      }
      if (input.eligibility.recommendedAction !== 'approve_advance') {
        throw new Error('Sales intake requires an approve_advance recommendation.');
      }
      if (input.eligibility.humanApprovalActor !== 'human_executive') {
        throw new Error('Sales intake requires recorded human executive approval.');
      }
      if (input.eligibility.atlasSourcePaths.length === 0) {
        throw new Error('Sales intake requires authoritative Atlas source paths.');
      }

      const taskId = required(input.taskId, 'taskId');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const eligibilityRecordId = required(input.eligibilityRecordId, 'eligibilityRecordId');
      const createdAt = required(input.createdAt, 'createdAt');

      const task: AgentRuntimeTask = {
        taskId,
        executionId,
        originAgent: 'lead_agent',
        destinationAgent: 'sales_agent',
        objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.',
        priority: 'normal',
        context: {
          leadId: input.eligibility.leadId,
          qualificationRecordId: input.eligibility.qualificationRecordId,
          dispositionRecordId: input.eligibility.dispositionRecordId,
          reviewExecutionId: input.eligibility.reviewExecutionId,
          reviewTaskId: input.eligibility.reviewTaskId,
          eligibilityRecordId,
        },
        knowledgeReferences: [...new Set(input.eligibility.atlasSourcePaths)],
        inputs: {
          leadId: input.eligibility.leadId,
          recommendedAction: 'approve_advance',
          humanApprovalActor: 'human_executive',
          salesIntakeOnly: true,
          salesDispatchAuthorised: false,
          outreachAuthorised: false,
        },
        expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
        dependencies: [],
        risks: [],
        confidence: 1,
        approvalRequired: false,
        status: 'queued',
        nextAction: 'configure_governed_sales_intake_processing',
        attempt: 1,
        maxAttempts: 1,
        correlationId,
        createdAt,
        updatedAt: createdAt,
      };

      const errors = validateAgentRuntimeTask(task);
      if (errors.length) throw new Error(errors.join(' '));
      return task;
    },
  };
}

export type LeadSalesIntakeTaskService = ReturnType<typeof createLeadSalesIntakeTaskService>;
