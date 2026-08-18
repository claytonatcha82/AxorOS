import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { DeterministicPaymentIntegration } from '../integrations/deterministic-payment-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createFinancePaymentRuntime } from './finance-payment-runtime.js';

function mockPool(): Pool {
  const pool = {
    async query(sql: string) {
      if (/insert into finance\.clearance_decisions/i.test(sql)) {
        return { rowCount: 1, rows: [{ clearance_id: 'finance-clearance:runtime:1' }] };
      }
      throw new Error(`Unexpected SQL in Finance payment runtime test: ${sql}`);
    },
  };
  return pool as unknown as Pool;
}

test('Finance payment runtime composes governed payment integration with PostgreSQL clearance persistence', async () => {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const runtime = createFinancePaymentRuntime({ pool: mockPool(), integrations });

  const result = await runtime.workflow.verifyAndPersist({
    clearanceId: 'finance-clearance:runtime:1',
    executionId: 'exec-finance-runtime-1',
    correlationId: 'corr-finance-runtime-1',
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox',
    expected: {
      providerPaymentReference: 'sandbox_paid_runtime_001',
      expectedAmountMinor: 250000,
      currency: 'ZAR',
      commercialRecordReference: 'commercial:runtime:1',
    },
  });

  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'FINANCE_CLEARED');
  assert.equal(result.decision.amountMinor, 250000);
  assert.equal(result.decision.currency, 'ZAR');
  assert.ok(result.decision.evidenceReferences.length > 0);
});
