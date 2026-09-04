import type { OperationalRepository, WorkflowEventRecord } from '../data/operational-repository.js';

export interface SalesGovernedOutreachHumanExecution {
  supervisedSendGateRecordId: string;
  humanReviewResolutionRecordId: string;
  preparationRecordId: string;
  leadId: string;
  status: 'authorised_for_manual_execution';
  humanExecutionConfirmed: true;
  preparationOnly: false;
  outreachAuthorised: true;
  dispatchAuthorised: false;
  sendAuthorised: true;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'execute_supervised_email_send';
  executedBy: 'human_executive';
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

export function createSalesGovernedOutreachHumanExecutionService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'findWorkflowEventByTypeAndPayloadField' | 'createWorkflowEvent'>,
) {
  return {
    async authorise(input: {
      supervisedSendGateRecordId: string;
      actorType: string;
      actorId: string;
      humanExecutionConfirmed: boolean;
    }): Promise<{ execution: SalesGovernedOutreachHumanExecution; record: WorkflowEventRecord }> {
      const gateId = requiredString(input.supervisedSendGateRecordId, 'supervisedSendGateRecordId');
      const actorType = requiredString(input.actorType, 'actorType');
      const actorId = requiredString(input.actorId, 'actorId');
      if (actorType !== 'founder' || actorId !== 'human_executive') {
        throw new Error('Supervised outreach execution requires the Human Executive actor.');
      }
      if (input.humanExecutionConfirmed !== true) {
        throw new Error('Explicit human execution confirmation is required.');
      }

      const gateRecord = await repository.getWorkflowEventById(gateId);
      if (!gateRecord) throw new Error(`Supervised send gate ${gateId} was not found.`);
      if (gateRecord.eventType !== 'sales_governed_outreach_supervised_send_gate_prepared') {
        throw new Error('Human execution requires the governed supervised send gate.');
      }
      if (gateRecord.actorType !== 'agent' || gateRecord.actorId !== 'sales_agent') {
        throw new Error('Supervised send gate must have Sales Agent provenance.');
      }

      const gate = payloadObject(gateRecord, 'Supervised send gate');
      if (
        gate.status !== 'ready_for_supervised_send'
        || gate.preparationOnly !== true
        || gate.outreachAuthorised !== true
        || gate.dispatchAuthorised !== false
        || gate.sendAuthorised !== false
        || gate.pricingAuthorised !== false
        || gate.commercialCommitmentAuthorised !== false
        || gate.humanExecutionRequired !== true
        || gate.nextAction !== 'await_manual_send_execution'
      ) {
        throw new Error('Supervised send gate is not valid for explicit human execution.');
      }

      const existing = await repository.findWorkflowEventByTypeAndPayloadField(
        'sales_supervised_send_gate_recorded',
        'sourceSupervisedSendGateRecordId',
        gateRecord.id,
      );
      if (existing) throw new Error(`Human execution authority for ${gateRecord.id} has already been recorded.`);

      const preparationRecordId = requiredString(gate.preparationRecordId, 'preparationRecordId');
      const preparationRecord = await repository.getWorkflowEventById(preparationRecordId);
      if (!preparationRecord) throw new Error(`Governed outreach preparation ${preparationRecordId} was not found.`);
      if (preparationRecord.eventType !== 'sales_governed_outreach_prepared') {
        throw new Error('Human execution requires the governed outreach preparation record.');
      }
      if (preparationRecord.actorType !== 'agent' || preparationRecord.actorId !== 'sales_agent') {
        throw new Error('Governed outreach preparation must have Sales Agent provenance.');
      }

      const preparation = payloadObject(preparationRecord, 'Governed outreach preparation');
      if (
        preparation.preparationOnly !== true
        || preparation.outreachAuthorised !== true
        || preparation.dispatchAuthorised !== false
        || preparation.sendAuthorised !== false
        || preparation.pricingAuthorised !== false
        || preparation.commercialCommitmentAuthorised !== false
        || preparation.humanReviewRequired !== true
      ) {
        throw new Error('Governed outreach preparation has invalid authority state.');
      }
      if (requiredString(preparation.leadId, 'preparation.leadId') !== requiredString(gate.leadId, 'gate.leadId')) {
        throw new Error('Supervised send gate and preparation reference different leads.');
      }

      const execution: SalesGovernedOutreachHumanExecution = {
        supervisedSendGateRecordId: gateRecord.id,
        humanReviewResolutionRecordId: requiredString(gate.humanReviewResolutionRecordId, 'humanReviewResolutionRecordId'),
        preparationRecordId,
        leadId: requiredString(preparation.leadId, 'preparation.leadId'),
        status: 'authorised_for_manual_execution',
        humanExecutionConfirmed: true,
        preparationOnly: false,
        outreachAuthorised: true,
        dispatchAuthorised: false,
        sendAuthorised: true,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'execute_supervised_email_send',
        executedBy: 'human_executive',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_supervised_send_gate_recorded',
        actorType: 'founder',
        actorId: 'human_executive',
        payload: {
          ...execution,
          draftRecordId: preparationRecord.id,
          approver: 'human_executive',
          supervised: true,
          decision: 'approved',
          sourceSupervisedSendGateRecordId: gateRecord.id,
        },
      });

      return { execution, record };
    },
  };
}

export type SalesGovernedOutreachHumanExecutionService = ReturnType<typeof createSalesGovernedOutreachHumanExecutionService>;
