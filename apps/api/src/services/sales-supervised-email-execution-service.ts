import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesEmailSendAttemptPostgresStore } from '../data/sales-email-send-attempt-postgres-store.js';

export interface SalesEmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface SalesEmailTransportResult {
  providerMessageId: string;
}

export interface SalesEmailTransport {
  send(message: SalesEmailMessage): Promise<SalesEmailTransportResult>;
}

export interface SalesSupervisedEmailExecution {
  sendGateRecordId: string;
  draftRecordId: string;
  leadId: string;
  recipientEmail: string;
  subject: string;
  providerMessageId: string;
  supervised: true;
  humanSendApprovalVerified: true;
  sendExecuted: true;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'record_outreach_and_monitor_response';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

export function createSalesSupervisedEmailExecutionService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'createWorkflowEvent'>,
  transport: SalesEmailTransport,
  sendAttempts: Pick<SalesEmailSendAttemptPostgresStore, 'reserve' | 'markSent' | 'markFailed'>,
) {
  return {
    async execute(sendGateRecordId: string) {
      const normalizedGateRecordId = requiredString(sendGateRecordId, 'sendGateRecordId');
      const gateRecord = await repository.getWorkflowEventById(normalizedGateRecordId);
      if (!gateRecord) throw new Error(`Sales supervised send gate record ${normalizedGateRecordId} was not found.`);
      if (gateRecord.eventType !== 'sales_supervised_send_gate_recorded') {
        throw new Error('Supervised email execution requires a persisted Sales send gate record.');
      }
      if (gateRecord.actorType !== 'founder' || gateRecord.actorId !== 'human_executive') {
        throw new Error('Supervised email execution requires human executive send-gate provenance.');
      }
      if (!gateRecord.payload || typeof gateRecord.payload !== 'object' || Array.isArray(gateRecord.payload)) {
        throw new Error('Sales supervised send gate payload is invalid.');
      }

      const gate = gateRecord.payload as Record<string, unknown>;
      if (gate.decision !== 'approved' || gate.approver !== 'human_executive' || gate.supervised !== true) {
        throw new Error('Supervised email execution requires explicit human send approval.');
      }
      if (gate.sendAuthorised !== true || gate.nextAction !== 'execute_supervised_email_send') {
        throw new Error('Sales send gate is not authorised for email execution.');
      }
      if (gate.outreachAuthorised !== false || gate.pricingAuthorised !== false || gate.commercialCommitmentAuthorised !== false) {
        throw new Error('Supervised email execution must not inherit unrelated commercial authority.');
      }

      const draftRecordId = requiredString(gate.draftRecordId, 'draftRecordId');
      const leadId = requiredString(gate.leadId, 'leadId');
      const draftRecord = await repository.getWorkflowEventById(draftRecordId);
      if (!draftRecord) throw new Error(`Sales outreach draft record ${draftRecordId} was not found.`);
      if (draftRecord.eventType !== 'sales_internal_outreach_draft_recorded') {
        throw new Error('Supervised email execution requires the persisted internal Sales outreach draft.');
      }
      if (draftRecord.actorType !== 'agent' || draftRecord.actorId !== 'sales_agent') {
        throw new Error('Supervised email execution requires Sales Agent draft provenance.');
      }
      if (!draftRecord.payload || typeof draftRecord.payload !== 'object' || Array.isArray(draftRecord.payload)) {
        throw new Error('Sales outreach draft payload is invalid.');
      }

      const draft = draftRecord.payload as Record<string, unknown>;
      if (requiredString(draft.leadId, 'draft.leadId') !== leadId) {
        throw new Error('Supervised send gate and outreach draft reference different leads.');
      }
      if (draft.status !== 'internal_review_required' || draft.humanReviewRequired !== true) {
        throw new Error('Persisted outreach draft is not a governed internal-review draft.');
      }
      if (draft.outreachAuthorised !== false || draft.sendAuthorised !== false || draft.pricingAuthorised !== false || draft.commercialCommitmentAuthorised !== false) {
        throw new Error('Persisted outreach draft must contain no inherited authority.');
      }

      const message: SalesEmailMessage = {
        to: requiredString(draft.recipientEmail, 'draft.recipientEmail'),
        subject: requiredString(draft.subject, 'draft.subject'),
        body: requiredString(draft.body, 'draft.body'),
      };

      const idempotencyKey = `sales-supervised-email-send:${gateRecord.id}`;
      await sendAttempts.reserve(gateRecord.id, idempotencyKey);

      let providerMessageId: string;
      try {
        const transportResult = await transport.send(message);
        providerMessageId = requiredString(transportResult.providerMessageId, 'providerMessageId');
        await sendAttempts.markSent(gateRecord.id, providerMessageId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await sendAttempts.markFailed(gateRecord.id, errorMessage).catch(() => undefined);
        throw error;
      }

      const execution: SalesSupervisedEmailExecution = {
        sendGateRecordId: gateRecord.id,
        draftRecordId: draftRecord.id,
        leadId,
        recipientEmail: message.to,
        subject: message.subject,
        providerMessageId,
        supervised: true,
        humanSendApprovalVerified: true,
        sendExecuted: true,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'record_outreach_and_monitor_response',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_supervised_email_sent',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: execution,
      });

      return { execution, record };
    },
  };
}

export type SalesSupervisedEmailExecutionService = ReturnType<typeof createSalesSupervisedEmailExecutionService>;
