import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceGovernedPaymentRequestResult } from './finance-governed-payment-request-service.js';

export interface FinanceGovernedCheckoutEmailAssemblyInput {
  task: AgentRuntimeTask;
  paymentRequest: FinanceGovernedPaymentRequestResult;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export function assembleFinanceGovernedCheckoutEmail(
  input: FinanceGovernedCheckoutEmailAssemblyInput,
): AgentRuntimeTask {
  const { task, paymentRequest } = input;
  if (task.destinationAgent !== 'finance_agent') {
    throw new Error('Governed Finance checkout email must target finance_agent.');
  }
  if (!task.approvalRequired || task.approvalOwner !== 'human_executive') {
    throw new Error('Governed Finance checkout email requires Human Executive approval before Gmail drafting.');
  }

  const financeContext = task.context.financeGovernedCommunication;
  if (!financeContext || typeof financeContext !== 'object' || Array.isArray(financeContext)) {
    throw new Error('Governed Finance communication context is required.');
  }
  const context = financeContext as Record<string, unknown>;
  const commercialRecordReference = requiredText(context.sourceCommercialRecordReference, 'Finance source commercial record');
  const gate = requiredText(context.gate, 'Finance payment gate');
  if (commercialRecordReference !== paymentRequest.requirement.commercialRecordReference) {
    throw new Error('Finance checkout commercial record does not match the governed communication context.');
  }
  if (gate !== paymentRequest.requirement.gate) {
    throw new Error('Finance checkout gate does not match the governed communication context.');
  }
  if (paymentRequest.requirement.status !== 'ACTIVE') {
    throw new Error(`Finance checkout requirement ${paymentRequest.requirement.requirementReference} is not ACTIVE.`);
  }

  const textBody = requiredText(task.inputs.textBody, 'Finance email textBody');
  const authorizationUrl = requiredText(paymentRequest.authorizationUrl, 'Finance checkout authorizationUrl');
  let parsed: URL;
  try { parsed = new URL(authorizationUrl); } catch { throw new Error('Finance checkout authorizationUrl must be a valid URL.'); }
  if (parsed.protocol !== 'https:') throw new Error('Finance checkout authorizationUrl must use HTTPS.');

  const assembledBody = [
    textBody,
    '',
    'Secure payment link:',
    authorizationUrl,
    '',
    `Payment reference: ${paymentRequest.providerPaymentReference}`,
  ].join('\n');

  return {
    ...task,
    context: {
      ...task.context,
      financeGovernedCommunication: {
        ...context,
        requirementReference: paymentRequest.requirement.requirementReference,
        providerPaymentReference: paymentRequest.providerPaymentReference,
        paymentRequestEvidenceReferences: [...paymentRequest.evidenceReferences],
        checkoutAuthorityAppendedDeterministically: true,
        sendAuthorised: false,
      },
    },
    inputs: {
      ...task.inputs,
      textBody: assembledBody,
    },
    updatedAt: new Date().toISOString(),
  };
}
