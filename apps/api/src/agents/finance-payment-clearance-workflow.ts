import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
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

export interface TrustedPaymentWebhookEvidenceReader {
  get(idempotencyKey: string): Promise<PaymentWebhookEvidence | null>;
}

export interface VerifyFinancePaymentInput {
  clearanceId: string;
  executionId: string;
  correlationId: string;
  paymentIntegrationId: string;
  mode: IntegrationMode;
  expected: PaymentVerificationInput;
  trustedPaymentWebhookIdempotencyKey?: string;
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

function uniqueEvidenceReferences(references: readonly string[]): string[] {
  return [...new Set(references.map((reference) => reference.trim()).filter(Boolean))];
}

function assertTrustedPaymentEvidenceMatchesExpected(
  evidence: PaymentWebhookEvidence,
  expected: PaymentVerificationInput,
): void {
  if (evidence.eventType !== 'payment_paid') {
    throw new Error('Trusted payment webhook evidence must be payment_paid before Finance clearance verification.');
  }
  if (evidence.providerPaymentReference !== expected.providerPaymentReference) {
    throw new Error('Trusted payment webhook evidence does not match the expected provider payment reference.');
  }
  if (evidence.commercialRecordReference !== expected.commercialRecordReference) {
    throw new Error('Trusted payment webhook evidence does not match the commercial record.');
  }
  if (evidence.amountMinor !== expected.expectedAmountMinor) {
    throw new Error('Trusted payment webhook evidence does not match the expected amount.');
  }
  if (evidence.currency !== expected.currency) {
    throw new Error('Trusted payment webhook evidence does not match the expected currency.');
  }
}

export function createFinancePaymentClearanceWorkflow(dependencies: {
  integrations: FinancePaymentVerificationExecutor;
  clearanceStore: FinanceClearanceDecisionWriter;
  paymentWebhookEvidenceStore?: TrustedPaymentWebhookEvidenceReader;
}) {
  return {
    async verifyAndPersist(input: VerifyFinancePaymentInput): Promise<VerifyFinancePaymentResult> {
      const clearanceId = required(input.clearanceId, 'clearanceId');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const paymentIntegrationId = required(input.paymentIntegrationId, 'paymentIntegrationId');

      let trustedPaymentEvidence: PaymentWebhookEvidence | null = null;
      if (input.trustedPaymentWebhookIdempotencyKey !== undefined) {
        const idempotencyKey = required(input.trustedPaymentWebhookIdempotencyKey, 'trustedPaymentWebhookIdempotencyKey');
        if (!dependencies.paymentWebhookEvidenceStore) {
          throw new Error('Trusted payment webhook evidence store is required when binding Finance clearance to a webhook event.');
        }
        trustedPaymentEvidence = await dependencies.paymentWebhookEvidenceStore.get(idempotencyKey);
        if (!trustedPaymentEvidence) {
          throw new Error('Trusted persisted payment webhook evidence was not found.');
        }
        assertTrustedPaymentEvidenceMatchesExpected(trustedPaymentEvidence, input.expected);
      }

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
      const evidenceReferences = uniqueEvidenceReferences([
        ...(trustedPaymentEvidence ? [trustedPaymentEvidence.evidenceReference] : []),
        ...evaluated.evidenceReferences,
      ]);
      const decision: PersistedFinanceClearanceDecision = {
        clearanceId,
        commercialRecordReference: input.expected.commercialRecordReference,
        providerPaymentReference: input.expected.providerPaymentReference,
        state: evaluated.state,
        reason: evaluated.reason,
        evidenceReferences,
        amountMinor: input.expected.expectedAmountMinor,
        currency: input.expected.currency,
        verifiedAt: decisionTimestamp(verification.output),
      };

      const persistence = await dependencies.clearanceStore.save(decision);
      return { decision, persistence };
    },
  };
}
