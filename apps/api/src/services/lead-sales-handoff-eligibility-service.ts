import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import type { AgentRuntimeStore } from '../agents/agent-runtime-store.js';

export interface LeadSalesHandoffEligibility {
  eligible: true;
  leadId: string;
  qualificationRecordId: string;
  dispositionRecordId: string;
  reviewExecutionId: string;
  reviewTaskId: string;
  recommendedAction: 'approve_advance';
  humanApprovalActor: 'human_executive';
  atlasSourcePaths: string[];
}

export interface LeadSalesHandoffEligibilityStore
  extends Pick<AgentRuntimeStore, 'getExecution' | 'listEvents'> {}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function approvedByHumanExecutive(events: readonly AgentRuntimeEvent[]): boolean {
  const approvalRequested = events.some((event) => event.type === 'approval_requested');
  const approvalGranted = events.some(
    (event) => event.type === 'approval_granted' && event.payload.actor === 'human_executive',
  );
  return approvalRequested && approvalGranted;
}

function assertApprovedReview(record: AgentRuntimeExecutionRecord, events: readonly AgentRuntimeEvent[]): void {
  if (record.task.destinationAgent !== 'lead_agent') {
    throw new Error('Lead to Sales handoff eligibility requires a Lead Agent review execution.');
  }
  if (record.task.status !== 'ready') {
    throw new Error(`Lead to Sales handoff eligibility requires approved ready status; received ${record.task.status}.`);
  }
  if (record.task.knowledgeReferences.length === 0) {
    throw new Error('Lead to Sales handoff eligibility requires authoritative Atlas source paths.');
  }

  const disposition = record.task.inputs.disposition;
  if (disposition !== 'hold' && disposition !== 'advance') {
    throw new Error('Lead to Sales handoff eligibility requires a valid disposition (hold or advance).');
  }

  if (record.task.inputs.recommendedAction !== 'approve_advance') {
    throw new Error('Lead to Sales handoff eligibility requires an approve_advance recommendation.');
  }

  if (disposition === 'hold') {
    if (record.task.approvalRequired) {
      throw new Error('Lead to Sales handoff eligibility requires the human approval gate to be cleared.');
    }
    if (!approvedByHumanExecutive(events)) {
      throw new Error('Lead to Sales handoff eligibility requires recorded human executive approval.');
    }
  }
}

export function createLeadSalesHandoffEligibilityService(store: LeadSalesHandoffEligibilityStore) {
  return {
    async evaluate(reviewExecutionId: string): Promise<LeadSalesHandoffEligibility> {
      const normalizedExecutionId = requiredText(reviewExecutionId, 'reviewExecutionId');
      const record = await store.getExecution(normalizedExecutionId);
      if (!record) throw new Error(`Lead qualification review execution ${normalizedExecutionId} was not found.`);

      const events = await store.listEvents(normalizedExecutionId);
      assertApprovedReview(record, events);

      const leadId = requiredText(record.task.context.leadId, 'leadId');
      const qualificationRecordId = requiredText(record.task.context.qualificationRecordId, 'qualificationRecordId');
      const dispositionRecordId = requiredText(record.task.context.dispositionRecordId, 'dispositionRecordId');

      return {
        eligible: true,
        leadId,
        qualificationRecordId,
        dispositionRecordId,
        reviewExecutionId: record.task.executionId,
        reviewTaskId: record.task.taskId,
        recommendedAction: 'approve_advance',
        humanApprovalActor: 'human_executive',
        atlasSourcePaths: [...new Set(record.task.knowledgeReferences)],
      };
    },
  };
}

export type LeadSalesHandoffEligibilityService = ReturnType<
  typeof createLeadSalesHandoffEligibilityService
>;
