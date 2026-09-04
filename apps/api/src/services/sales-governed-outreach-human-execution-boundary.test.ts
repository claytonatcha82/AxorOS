import assert from 'node:assert/strict';
import test from 'node:test';

import { createSalesGovernedOutreachHumanExecutionService } from './sales-governed-outreach-human-execution-service.js';

function repository(events: Record<string, any>) {
  return {
    async getWorkflowEventById(id: string) { return events[id] ?? null; },
    async findWorkflowEventByTypeAndPayloadField() { return null; },
    async createWorkflowEvent(input: any) { return { id: 'created', ...input }; },
  };
}

const preparation = {
  id: 'preparation-1', eventType: 'sales_governed_outreach_prepared', actorType: 'agent', actorId: 'sales_agent',
  payload: { leadId: 'lead-1', status: 'prepared_for_human_review', preparationOnly: true, outreachAuthorised: true,
    dispatchAuthorised: false, sendAuthorised: false, pricingAuthorised: false, commercialCommitmentAuthorised: false,
    humanReviewRequired: true }
};
const gate = {
  id: 'gate-1', eventType: 'sales_governed_outreach_supervised_send_gate_prepared', actorType: 'agent', actorId: 'sales_agent',
  payload: { preparationRecordId: 'preparation-1', humanReviewResolutionRecordId: 'review-resolution-1', leadId: 'lead-1', status: 'ready_for_supervised_send', preparationOnly: true,
    outreachAuthorised: true, dispatchAuthorised: false, sendAuthorised: false, pricingAuthorised: false,
    commercialCommitmentAuthorised: false, humanExecutionRequired: true, nextAction: 'await_manual_send_execution' }
};

test('human execution creates send authority only for the Human Executive', async () => {
  const service = createSalesGovernedOutreachHumanExecutionService(repository({ 'gate-1': gate, 'preparation-1': preparation }));
  const result = await service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true });
  assert.equal(result.execution.sendAuthorised, true);
  assert.equal(result.execution.dispatchAuthorised, false);
  assert.equal(result.execution.pricingAuthorised, false);
  assert.equal(result.execution.commercialCommitmentAuthorised, false);
});

test('agent cannot create human execution authority', async () => {
  const service = createSalesGovernedOutreachHumanExecutionService(repository({ 'gate-1': gate, 'preparation-1': preparation }));
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'agent', actorId: 'sales_agent', humanExecutionConfirmed: true }), /Human Executive/);
});

test('explicit confirmation is mandatory', async () => {
  const service = createSalesGovernedOutreachHumanExecutionService(repository({ 'gate-1': gate, 'preparation-1': preparation }));
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: false }), /explicit human execution confirmation/);
});

test('forged pre-authorised supervised gate is rejected', async () => {
  const forged = { ...gate, payload: { ...gate.payload, sendAuthorised: true } };
  const service = createSalesGovernedOutreachHumanExecutionService(repository({ 'gate-1': forged, 'preparation-1': preparation }));
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true }), /not valid for human execution/);
});
