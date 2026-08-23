import type { EmailRecipient } from '../integrations/email-integration.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { assembleFinanceGovernedCheckoutEmail } from './finance-governed-checkout-email-assembly.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';
import type {
  FinanceGovernedPaymentRequestInput,
  FinanceGovernedPaymentRequestResult,
} from './finance-governed-payment-request-service.js';

export interface FinanceGovernedCheckoutEmailPreparationDependencies {
  paymentRequestService: {
    initialize(input: FinanceGovernedPaymentRequestInput): Promise<FinanceGovernedPaymentRequestResult>;
  };
  emailPreparationService: {
    prepare(input: {
      executionId: string;
      correlationId: string;
      decision: FinanceGovernedOperationalDecision;
      to: readonly EmailRecipient[];
      subject: string;
      fromIdentity?: string;
      createdAt?: string;
    }): Promise<AgentRuntimeTask>;
  };
}

export interface FinanceGovernedCheckoutEmailPreparationInput {
  executionId: string;
  correlationId: string;
  decision: FinanceGovernedOperationalDecision;
  to: readonly EmailRecipient[];
  subject: string;
  fromIdentity?: string;
  createdAt?: string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function createFinanceGovernedCheckoutEmailPreparationService(
  dependencies: FinanceGovernedCheckoutEmailPreparationDependencies,
) {
  return {
    async prepare(input: FinanceGovernedCheckoutEmailPreparationInput): Promise<AgentRuntimeTask> {
      if (!Array.isArray(input.to) || input.to.length === 0) {
        throw new Error('Finance governed checkout email requires at least one recipient.');
      }
      if (input.to.length !== 1) {
        throw new Error('Finance governed checkout email requires exactly one recipient so checkout authority cannot be shared across clients.');
      }

      const executionId = required(input.executionId, 'Finance checkout email executionId');
      const correlationId = required(input.correlationId, 'Finance checkout email correlationId');
      const recipientEmail = required(input.to[0]!.email, 'Finance checkout recipient email');

      const paymentRequest = await dependencies.paymentRequestService.initialize({
        commercialRecordReference: input.decision.commercialRecordReference,
        gate: input.decision.gate,
        recipientEmail,
        executionId: `payment-request:${executionId}`,
        correlationId,
      });

      const preparedTask = await dependencies.emailPreparationService.prepare({
        executionId,
        correlationId,
        decision: input.decision,
        to: input.to,
        subject: input.subject,
        ...(input.fromIdentity ? { fromIdentity: input.fromIdentity } : {}),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      });

      return assembleFinanceGovernedCheckoutEmail({
        task: preparedTask,
        paymentRequest,
      });
    },
  };
}
