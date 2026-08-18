import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { IntegrationMode, IntegrationResponse } from '../integrations/integration-contract.js';
import type { PaymentVerificationInput, PaymentVerificationOutput } from '../integrations/payment-integration.js';
import { evaluateFinanceClearance } from './finance-clearance-gate.js';

export interface FinancePaymentVerificationExecutor {
  execute<TInput = Record<string, unknown>, TOutput = Record<string, unknown>>(request: {
    integrationId: string;
    operation: string;
    requestedBy: 'finance_agent';
    executionId: string;
    correlationId: string;
    mode: IntegrationMode;
    risk: 'high';
    input: TInput;
    idempotencyKey: string;
  }): Promise<IntegrationResponse<TOutput>>;
}

export interface FinanceClearanceDecisionWriter {
  save(decision: PersistedFinanceClearanceDecision): Promise<'accepted' | 'duplicate'>;
}

export interface VerifyFinancePaymentInput {
  clearanceId: string;
  executionId: string;
  correlationId: string;
  paymentIntegrationId: string;
  mode: IntegrationMode;
  expected: PaymentVerificationInput;
}

export interface VerifyFinancePaymentResult {
  decision: PersistedFinanceClearanceDecision;
  persistence: 'accepted' | 'duplicate';
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function decisionTimestamp(output: PaymentVerificationOutput): string {
  if (output.verifiedAt?.trim() && !Number.isNaN(Date.parse(output.verifiedAt))) {
    return new Date(output.verifiedAt).toISOString();
  }
  return new Date(0).toISOString();
}

export function createFinancePaymentClearanceWorkflow(dependencies: {
  integrations: FinancePaymentVerificationExecutor;
  clearanceStore: FinanceClearanceDecisionWriter;
}) {
  return {
    async verifyAndPersist(input: VerifyFinancePaymentInput): Promise<VerifyFinancePaymentResult> {
      const clearanceId = required(input.clearanceId, 'clearanceId');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const paymentIntegrationId = required(input.paymentIntegrationId, 'paymentIntegrationId');

      const verification = await dependencies.integrations.execute<PaymentVerificationInput, PaymentVerificationOutput>({
        integrationId: paymentIntegrationId,
        operation: 'verify_payment',
        requestedBy: 'finance_agent',
        executionId,
        correlationId,
        mode: input.mode,
        risk: 'high',
        input: input.expected,
        idempotencyKey: `finance-payment-verification:${clearanceId}`,
      });

      const evaluated = evaluateFinanceClearance(input.expected, verification);
      const decision: PersistedFinanceClearanceDecision = {
        clearanceId,
        commercialRecordReference: input.expected.commercialRecordReference,
        providerPaymentReference: input.expected.providerPaymentReference,
        state: evaluated.state,
        reason: evaluated.reason,
        evidenceReferences: evaluated.evidenceReferences,
        amountMinor: input.expected.expectedAmountMinor,
        currency: input.expected.currency,
        verifiedAt: decisionTimestamp(verification.output),
      };

      const persistence = await dependencies.clearanceStore.save(decision);
      return { decision, persistence };
    },
  };
}
