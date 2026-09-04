import type { OperationalRepository, WorkflowEventRecord } from '../data/operational-repository.js';

export interface SalesGovernedOutreachSupervisedSendGate {
  humanReviewResolutionRecordId: string;
  reviewRequestRecordId: string;
  preparationRecordId: string;
  resolutionRecordId: string;
  status: 'ready_for_supervised_send';
  preparationOnly: true;
  outreachAuthorised: true;
  dispatchAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  humanExecutionRequired: true;
  nextAction: 'await_manual_send_execution';
  reason?: string;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function payloadObject(record: WorkflowEventRecord, label: string): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error(`${label} payload is invalid.`);
  }
  return record.payload as Record<string, unknown>;
}

export function createSalesGovernedOutreachSupervisedSendGateService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'findWorkflowEventByTypeAndPayloadField' | 'createWorkflowEvent'>,
) {
  return {
    async prepare(humanReviewResolutionRecordId: string): Promise<{
      gate: SalesGovernedOutreachSupervisedSendGate;
      record: WorkflowEventRecord;
    }> {
      const id = requiredString(humanReviewResolutionRecordId, 'humanReviewResolutionRecordId');
      const resolutionRecord = await repository.getWorkflowEventById(id);
      if (!resolutionRecord) throw new Error(`Governed outreach human review resolution ${id} was not found.`);
      if (resolutionRecord.eventType !== 'sales_governed_outreach_human_review_resolved') {
        throw new Error('Supervised send gate requires a governed outreach human review resolution.');
      }
      if (resolutionRecord.actorType !== 'founder' || resolutionRecord.actorId !== 'human_executive') {
        throw new Error('Supervised send gate requires a human executive review resolution.');
      }

      const resolution = payloadObject(resolutionRecord, 'Governed outreach human review resolution');
      if (
        resolution.decision !== 'approved'
        || resolution.reviewComplete !== true
        || resolution.preparationOnly !== true
        || resolution.outreachAuthorised !== false
        || resolution.dispatchAuthorised !== false
        || resolution.sendAuthorised !== false
        || resolution.pricingAuthorised !== false
        || resolution.commercialCommitmentAuthorised !== false
        || resolution.nextAction !== 'prepare_supervised_send_gate'
      ) {
        throw new Error('Governed outreach human review resolution is not valid for supervised send preparation.');
      }

      const existing = await repository.findWorkflowEventByTypeAndPayloadField(
        'sales_governed_outreach_supervised_send_gate_prepared',
        'humanReviewResolutionRecordId',
        resolutionRecord.id,
      );
      if (existing) throw new Error(`Supervised send gate for ${resolutionRecord.id} has already been prepared.`);

      const gate: SalesGovernedOutreachSupervisedSendGate = {
        humanReviewResolutionRecordId: resolutionRecord.id,
        reviewRequestRecordId: requiredString(resolution.reviewRequestRecordId, 'reviewRequestRecordId'),
        preparationRecordId: requiredString(resolution.preparationRecordId, 'preparationRecordId'),
        resolutionRecordId: requiredString(resolution.resolutionRecordId, 'resolutionRecordId'),
        status: 'ready_for_supervised_send',
        preparationOnly: true,
        outreachAuthorised: true,
        dispatchAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        humanExecutionRequired: true,
        nextAction: 'await_manual_send_execution',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_governed_outreach_supervised_send_gate_prepared',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: gate,
      });

      return { gate, record };
    },
  };
}

export type SalesGovernedOutreachSupervisedSendGateService = ReturnType<typeof createSalesGovernedOutreachSupervisedSendGateService>;
