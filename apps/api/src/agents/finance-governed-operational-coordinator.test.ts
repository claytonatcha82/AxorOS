import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceGovernedOperationalCoordinator } from './finance-governed-operational-coordinator.js';
import type { PersistedCommercialPaymentRequirement } from '../data/commercial-payment-requirement-postgres-store.js';
import type { PersistedCommercialPaymentSatisfaction } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { PersistedFinancePaymentCurrentState } from '../data/finance-payment-current-state-postgres-store.js';

const commercialRecordReference = 'commercial:finance-operational:1';
const requirementReference = 'deposit:commercial:finance-operational:1';

function requirement(overrides: Partial<PersistedCommercialPaymentRequirement> = {}): PersistedCommercialPaymentRequirement {
  return {
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 10000,
    currency: 'ZAR',
    status: 'ACTIVE',
    ...overrides,
  };
}

function payment(overrides: Partial<PersistedFinancePaymentCurrentState> = {}): PersistedFinancePaymentCurrentState {
  return {
    provider: 'paystack',
    providerPaymentReference: 'pay-1',
    commercialRecordReference,
    paymentStatus: 'CONFIRMED',
    authorityState: 'AUTHORIZED',
    reason: 'Verified provider payment confirmation supports Finance authorization.',
    latestEventType: 'payment_paid',
    latestProviderEventReference: 'event-1',
    latestEvidenceReference: 'payment-provider:paystack:event-1',
    latestOccurredAt: '2026-08-23T08:00:00.000Z',
    amountMinor: 10000,
    currency: 'ZAR',
    ...overrides,
  };
}

function satisfaction(overrides: Partial<PersistedCommercialPaymentSatisfaction> = {}): PersistedCommercialPaymentSatisfaction {
  return {
    requirementReference,
    clearanceId: 'finance-clearance:1',
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    satisfiedAt: '2026-08-23T08:01:00.000Z',
    ...overrides,
  };
}

function coordinator(options: {
  requirement?: PersistedCommercialPaymentRequirement | null;
  payment?: PersistedFinancePaymentCurrentState | null;
  satisfaction?: PersistedCommercialPaymentSatisfaction | null;
} = {}) {
  return createFinanceGovernedOperationalCoordinator({
    requirementStore: { async get() { return options.requirement === undefined ? requirement() : options.requirement; } },
    satisfactionStore: { async get() { return options.satisfaction ?? null; } },
    currentStateStore: { async get() { return options.payment === undefined ? payment() : options.payment; } },
  });
}

const input = {
  commercialRecordReference,
  gate: 'PRODUCTION_START' as const,
  provider: 'paystack',
  providerPaymentReference: 'pay-1',
};

test('Finance operational coordinator blocks missing commercial requirement', async () => {
  const result = await coordinator({ requirement: null }).assess(input);
  assert.equal(result.state, 'BLOCKED_MISSING_REQUIREMENT');
});

test('Finance operational coordinator waits for authoritative provider payment evidence', async () => {
  const result = await coordinator({ payment: null }).assess(input);
  assert.equal(result.state, 'AWAITING_VERIFIED_PAYMENT');
});

test('Finance operational coordinator routes disputed payments to manual review', async () => {
  const result = await coordinator({
    payment: payment({ paymentStatus: 'DISPUTED', authorityState: 'MANUAL_REVIEW', reason: 'Disputed payment requires Finance and Executive review.' }),
  }).assess(input);
  assert.equal(result.state, 'MANUAL_REVIEW');
  assert.equal(result.paymentStatus, 'DISPUTED');
});

test('Finance operational coordinator keeps blocked adverse payment state fail closed', async () => {
  const result = await coordinator({
    payment: payment({ paymentStatus: 'CHARGEBACK', authorityState: 'BLOCKED', reason: 'Chargeback invalidates payment-dependent Finance authorization.' }),
  }).assess(input);
  assert.equal(result.state, 'PAYMENT_BLOCKED');
});

test('Finance operational coordinator identifies verified payment ready for governed binding without mutating state', async () => {
  const result = await coordinator().assess(input);
  assert.equal(result.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(result.requirementReference, requirementReference);
  assert.equal(result.paymentEvidenceReference, 'payment-provider:paystack:event-1');
});

test('Finance operational coordinator returns already-satisfied immutable gate before consulting current payment state', async () => {
  const result = await coordinator({ satisfaction: satisfaction(), payment: null }).assess(input);
  assert.equal(result.state, 'REQUIREMENT_SATISFIED');
  assert.equal(result.clearanceId, 'finance-clearance:1');
});

test('Finance operational coordinator routes cross-commercial payment evidence to manual review', async () => {
  const result = await coordinator({ payment: payment({ commercialRecordReference: 'commercial:other' }) }).assess(input);
  assert.equal(result.state, 'MANUAL_REVIEW');
  assert.match(result.reason, /different commercial record/i);
});
