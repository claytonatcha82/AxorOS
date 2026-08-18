import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommercialPaymentGateSatisfied, satisfyCommercialPaymentRequirement } from './finance-commercial-payment-requirement.js';

const cleared = {
  clearanceId: 'clearance:milestone:1', commercialRecordReference: 'commercial:1', providerPaymentReference: 'pay:1',
  state: 'FINANCE_CLEARED' as const, reason: 'Verified payment.', evidenceReferences: ['payment-provider:test:event:1'],
  amountMinor: 50000, currency: 'ZAR', verifiedAt: '2026-08-18T18:00:00.000Z',
};

function requirement(gate: 'PRODUCTION_START' | 'MILESTONE_RELEASE' | 'FINAL_HANDOVER', overrides: Record<string, unknown> = {}) {
  return {
    commercialRecordReference: 'commercial:1', gate, requirementReference: `requirement:${gate}:1`,
    requirementType: gate === 'PRODUCTION_START' ? 'DEPOSIT' as const : gate === 'MILESTONE_RELEASE' ? 'MILESTONE' as const : 'FINAL' as const,
    requiredAmountMinor: 50000, currency: 'ZAR', status: 'ACTIVE' as const, ...overrides,
  };
}

function stores(req: ReturnType<typeof requirement>, clearance = cleared) {
  let saved: any = null;
  return {
    requirementStore: { async get() { return req; } },
    clearanceStore: { async get() { return clearance; } },
    satisfactionStore: {
      async save(value: any) { saved = value; return 'accepted' as const; },
      async get() { return saved; },
    },
    getSaved: () => saved,
  };
}

for (const gate of ['PRODUCTION_START', 'MILESTONE_RELEASE', 'FINAL_HANDOVER'] as const) {
  test(`${gate} creates and enforces an explicit clearance-to-requirement satisfaction`, async () => {
    const req = requirement(gate);
    const state = stores(req);
    const result = await satisfyCommercialPaymentRequirement(state, {
      commercialRecordReference: req.commercialRecordReference,
      gate,
      clearanceId: cleared.clearanceId,
    });
    assert.equal(result.persistence, 'accepted');
    assert.equal(result.satisfaction.requirementReference, req.requirementReference);
    assert.equal(result.satisfaction.gate, gate);
    await assert.doesNotReject(() => assertCommercialPaymentGateSatisfied(state, {
      commercialRecordReference: req.commercialRecordReference,
      gate,
      clearanceId: cleared.clearanceId,
    }));
  });
}

test('underfunded clearance cannot satisfy a milestone requirement', async () => {
  const req = requirement('MILESTONE_RELEASE', { requiredAmountMinor: 50001 });
  const state = stores(req);
  await assert.rejects(() => satisfyCommercialPaymentRequirement(state, {
    commercialRecordReference: req.commercialRecordReference,
    gate: 'MILESTONE_RELEASE',
    clearanceId: cleared.clearanceId,
  }), /amount does not satisfy/);
  assert.equal(state.getSaved(), null);
});

test('deposit satisfaction cannot be reused as milestone satisfaction', async () => {
  const deposit = requirement('PRODUCTION_START');
  const milestone = requirement('MILESTONE_RELEASE');
  const depositState = stores(deposit);
  const depositResult = await satisfyCommercialPaymentRequirement(depositState, {
    commercialRecordReference: deposit.commercialRecordReference,
    gate: 'PRODUCTION_START',
    clearanceId: cleared.clearanceId,
  });
  const milestoneState = {
    requirementStore: { async get() { return milestone; } },
    satisfactionStore: { async get() { return depositResult.satisfaction; } },
  };
  await assert.rejects(() => assertCommercialPaymentGateSatisfied(milestoneState, {
    commercialRecordReference: milestone.commercialRecordReference,
    gate: 'MILESTONE_RELEASE',
    clearanceId: cleared.clearanceId,
  }), /does not match the commercial gate/);
});

test('clearance in the wrong currency cannot satisfy final handover', async () => {
  const req = requirement('FINAL_HANDOVER', { currency: 'USD' });
  const state = stores(req);
  await assert.rejects(() => satisfyCommercialPaymentRequirement(state, {
    commercialRecordReference: req.commercialRecordReference,
    gate: 'FINAL_HANDOVER',
    clearanceId: cleared.clearanceId,
  }), /currency does not satisfy/);
});
