import type { AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import { validateAgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import type { LeadQualificationDisposition } from './lead-qualification-disposition-service.js';

export interface CreateLeadQualificationRuntimeReviewInput {
  taskId: string;
  executionId: string;
  correlationId: string;
  leadId: string;
  qualificationRecordId: string;
  dispositionRecordId: string;
  disposition: LeadQualificationDisposition;
  confidence: number;
  createdAt: string;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createLeadQualificationRuntimeReviewService() {
  return {
    createTask(input: CreateLeadQualificationRuntimeReviewInput): AgentRuntimeTask {
      if (input.disposition.disposition !== 'hold') {
        throw new Error('Lead qualification runtime review requires a conservative hold disposition.');
      }
      if (input.disposition.humanApprovalRequired !== true) {
        throw new Error('Lead qualification runtime review must preserve human approval authority.');
      }
      if (input.disposition.atlasSourcePaths.length === 0) {
        throw new Error('Lead qualification runtime review requires authoritative Atlas source paths.');
      }

      const taskId = required(input.taskId, 'taskId');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const leadId = required(input.leadId, 'leadId');
      const qualificationRecordId = required(input.qualificationRecordId, 'qualificationRecordId');
      const dispositionRecordId = required(input.dispositionRecordId, 'dispositionRecordId');
      const createdAt = required(input.createdAt, 'createdAt');

      const task: AgentRuntimeTask = {
        taskId,
        executionId,
        originAgent: 'lead_agent',
        destinationAgent: 'lead_agent',
        objective: 'Obtain human review of the Atlas-backed lead qualification disposition.',
        priority: 'normal',
        context: {
          leadId,
          qualificationRecordId,
          dispositionRecordId,
        },
        knowledgeReferences: [...new Set(input.disposition.atlasSourcePaths)],
        inputs: {
          leadId,
          qualificationRecordId,
          dispositionRecordId,
          disposition: input.disposition.disposition,
          recommendedAction: input.disposition.recommendedAction,
          reasons: [...input.disposition.reasons],
        },
        expectedOutput: 'A governed human approval decision for the recorded lead qualification disposition.',
        dependencies: [],
        risks: [...input.disposition.reasons],
        confidence: input.confidence,
        approvalRequired: true,
        approvalOwner: 'human_executive',
        status: 'ready',
        nextAction: 'obtain_required_approval',
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

export type LeadQualificationRuntimeReviewService = ReturnType<typeof createLeadQualificationRuntimeReviewService>;
