import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesCommercialCloseFinanceGateService } from './sales-commercial-close-finance-gate-service.js';

function salesRecord(payloadOverrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return {
    id: 'sales-close-1',
    clientId: null,
    projectId: null,
    eventType: 'sales_commercial_close_recorded',
    actorType: 'agent',
    actorId: 'sales_agent',
    payload: {
      leadId: 'lead-1',
      commercialOutcome: 'accepted',
      paymentConfirmed: false,
      productionAuthorised: false,
      ...payloadOverrides,
    },
    createdAt: '2026-08-22T09:00:00.000Z',
  };
}

function financeRecord(overrides: Partial<WorkflowEventRecord> = {}, payloadOverrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return {
    id: 'finance-clearance-1',
    clientId: null,
    projectId: null,
    eventType: 'finance_clearance_recorded',
    actorType: 'agent',
    actorId: 'finance_agent',
    payload: {
      leadId: 'lead-1',
      clearanceStatus: 'cleared',
      paymentConfirmed: true,
      ...payloadOverrides,
    },
    createdAt: '2026-08-22T09:05:00.000Z',
    ...overrides,
  };
}

function serviceFor(records: Record<string, WorkflowEventRecord | null>) {
  return createSalesCommercialCloseFinanceGateService({
    async getWorkflowEventById(id: string) {
      return records[id] ?? null;
    },
  });
}

test('accepted Sales close remains on Finance hold when no Finance clearance exists', async () => {
  const result = await serviceFor({ 'sales-close-1': salesRecord() }).evaluate('sales-close-1');

  assert.equal(result.eligible, false);
  assert.equal(result.financeClearanceRequired, true);
  assert.equal(result.financeCleared, false);
  assert.equal(result.productionAuthorised, false);
  assert.equal(result.nextAction, 'await_finance_clearance');
});

test('verified Finance clearance permits only an Operations production-readiness request', async () => {
  const result = await serviceFor({
    'sales-close-1': salesRecord(),
    'finance-clearance-1': financeRecord(),
  }).evaluate('sales-close-1', 'finance-clearance-1');

  assert.equal(result.eligible, true);
  assert.equal(result.financeCleared, true);
  assert.equal(result.productionAuthorised, false);
  assert.equal(result.nextAction, 'request_operations_production_readiness');
});

test('Sales cannot self-assert payment confirmation', async () => {
  await assert.rejects(
    () => serviceFor({ 'sales-close-1': salesRecord({ paymentConfirmed: true }) }).evaluate('sales-close-1'),
    /must not grant payment confirmation or Production authority/i,
  );
});

test('Sales cannot self-authorise Production', async () => {
  await assert.rejects(
    () => serviceFor({ 'sales-close-1': salesRecord({ productionAuthorised: true }) }).evaluate('sales-close-1'),
    /must not grant payment confirmation or Production authority/i,
  );
});

test('non-Finance actor cannot provide Finance clearance', async () => {
  await assert.rejects(
    () => serviceFor({
      'sales-close-1': salesRecord(),
      'finance-clearance-1': financeRecord({ actorId: 'sales_agent' }),
    }).evaluate('sales-close-1', 'finance-clearance-1'),
    /Finance Agent boundary/i,
  );
});

test('uncleared Finance evidence fails closed', async () => {
  await assert.rejects(
    () => serviceFor({
      'sales-close-1': salesRecord(),
      'finance-clearance-1': financeRecord({}, { clearanceStatus: 'pending', paymentConfirmed: false }),
    }).evaluate('sales-close-1', 'finance-clearance-1'),
    /cleared Finance evidence with confirmed payment/i,
  );
});

test('Finance clearance for another lead fails closed', async () => {
  await assert.rejects(
    () => serviceFor({
      'sales-close-1': salesRecord(),
      'finance-clearance-1': financeRecord({}, { leadId: 'lead-2' }),
    }).evaluate('sales-close-1', 'finance-clearance-1'),
    /does not belong/i,
  );
});
