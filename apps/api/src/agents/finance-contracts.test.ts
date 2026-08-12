import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFinanceRequest, validateMoney } from './finance-contracts.js';

test('money uses integer minor units and explicit currency', () => {
  assert.deepEqual(validateMoney({ amountMinor: 150000, currency: 'ZAR' }), []);
  assert.ok(validateMoney({ amountMinor: -1, currency: 'ZAR' }).length > 0);
  assert.ok(validateMoney({ amountMinor: 1500.5, currency: 'USD' }).length > 0);
  assert.ok(validateMoney({ amountMinor: 100, currency: '' }).length > 0);
});

test('finance request requires commercial evidence rather than casual conversation', () => {
  const errors = validateFinanceRequest({ financeRequestId: 'fr-1', requestType: 'invoice', clientId: 'c1', projectId: 'p1', sourceAgent: 'sales_agent', commercialReference: '', money: { amountMinor: 500000, currency: 'ZAR' }, taxTreatment: 'configured_policy', paymentType: 'deposit', paymentStage: 'initial', description: 'Project deposit', invoiceRequired: true, paymentLinkRequired: true, approvalStatus: 'approved', supportingRecords: [] });
  assert.ok(errors.includes('commercialReference is required.'));
  assert.ok(errors.includes('supportingRecords are required.'));
});
