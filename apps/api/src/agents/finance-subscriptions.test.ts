import assert from 'node:assert/strict';
import test from 'node:test';
import { mayAccessFinanceRecord, subscriptionFailureEvent, validateSubscription } from './finance-subscriptions.js';

test('recurring revenue records require client currency and invoice policy', () => {
  assert.deepEqual(validateSubscription({ subscriptionId: 's1', clientId: 'c1', service: 'maintenance', billingFrequency: 'monthly', amountMinor: 100000, currency: 'ZAR', startDate: '2026-08-01', nextBillingDate: '2026-09-01', status: 'ACTIVE', autoRenew: true, paymentMethodReference: 'pm_ref', invoicePolicy: 'monthly_in_advance' }), []);
});

test('finance records never cross client ownership boundaries', () => {
  assert.equal(mayAccessFinanceRecord('client-a', 'client-a'), true);
  assert.equal(mayAccessFinanceRecord('client-a', 'client-b'), false);
  assert.equal(mayAccessFinanceRecord('', 'client-b'), false);
});

test('subscription failure produces machine-readable finance events', () => {
  assert.equal(subscriptionFailureEvent('PAST_DUE'), 'SUBSCRIPTION_PAST_DUE');
  assert.equal(subscriptionFailureEvent('SUSPENDED'), 'FINANCE_HOLD');
  assert.equal(subscriptionFailureEvent('ACTIVE'), null);
});
