import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import {
  decideFinanceGovernedCommunication,
  type FinanceGovernedCommunicationDecision,
} from './finance-governed-communication-policy.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';

export interface FinanceGovernedCommunicationDraftInput {
  executionId: string;
  correlationId: string;
  decision: FinanceGovernedOperationalDecision;
}

export interface FinanceGovernedCommunicationDraftServiceDependencies {
  integrations: IntegrationRegistry;
  integrationId?: string;
}

function promptFor(policy: FinanceGovernedCommunicationDecision): string {
  switch (policy.intent) {
    case 'DRAFT_PAYMENT_VERIFICATION_REQUEST':
      return 'Draft a concise professional client message stating that payment is awaiting verification. Ask the client to provide or confirm the payment reference if available. Do not state or imply that payment has been received, confirmed, settled, or cleared.';
    case 'DRAFT_PAYMENT_ISSUE_NOTICE':
      return 'Draft a concise professional client message explaining that the current payment state does not authorize the commercial gate. Use only the supplied authoritative reason. Do not invent a remedy, deadline, fee, penalty, refund, discount, bank detail, or payment instruction.';
    case 'DRAFT_PAYMENT_CONFIRMATION':
      return 'Draft a concise professional client message confirming only that the governed commercial payment requirement for the stated gate is satisfied by persisted Finance clearance. Do not invent amounts, invoice numbers, settlement dates, bank details, tax facts, delivery promises, or additional commercial terms.';
    case 'INTERNAL_BINDING_PENDING':
    case 'INTERNAL_REVIEW_ONLY':
      throw new Error(`Finance communication intent ${policy.intent} does not permit model drafting.`);
  }
}

function contextFor(
  decision: FinanceGovernedOperationalDecision,
  policy: FinanceGovernedCommunicationDecision,
): string {
  return [
    'AUTHORITATIVE GOVERNED FINANCE COMMUNICATION CONTEXT',
    `Commercial record: ${decision.commercialRecordReference}`,
    `Gate: ${decision.gate}`,
    `Operational state: ${decision.state}`,
    `Communication intent: ${policy.intent}`,
    `Authoritative reason: ${decision.reason}`,
    `Payment status: ${decision.paymentStatus ?? 'not_available'}`,
    `Authority state: ${decision.authorityState ?? 'not_available'}`,
    `Requirement reference: ${decision.requirementReference ?? 'not_available'}`,
    `Clearance ID: ${decision.clearanceId ?? 'not_available'}`,
    `Evidence references: ${policy.evidenceReferences.length > 0 ? policy.evidenceReferences.join(', ') : 'none'}`,
    'The operational state and communication intent above are authoritative. The model may draft wording only and may not change, reinterpret, upgrade, or create financial authority.',
  ].join('\n');
}

export function createFinanceGovernedCommunicationDraftService(
  dependencies: FinanceGovernedCommunicationDraftServiceDependencies,
) {
  const integrationId = dependencies.integrationId ?? 'model.gemini';

  return {
    async draft(input: FinanceGovernedCommunicationDraftInput) {
      const policy = decideFinanceGovernedCommunication(input.decision);
      if (!policy.clientCommunicationAllowed || !policy.modelDraftAllowed) {
        throw new Error(`Finance deterministic communication policy does not permit client-facing model drafting for ${policy.operationalState}.`);
      }

      const response = await dependencies.integrations.execute<ModelGenerationInput, ModelGenerationOutput>({
        integrationId,
        operation: 'generate_text',
        requestedBy: 'finance_agent',
        executionId: input.executionId,
        correlationId: input.correlationId,
        mode: 'draft',
        risk: 'low',
        input: {
          prompt: promptFor(policy),
          context: contextFor(input.decision, policy),
          systemInstruction: [
            'You are the AxorOS Finance Agent drafting client-facing finance communication under deterministic governance.',
            'The supplied Finance operational state and communication intent are authoritative and immutable for this response.',
            'Draft only the communication type explicitly permitted by the deterministic policy.',
            'Never infer payment success, clearance, settlement, requirement satisfaction, or gate authority beyond the supplied state.',
            'Never create or authorize a payment, refund, transfer, discount, credit, invoice, payment link, bank change, ledger mutation, commercial commitment, or money movement.',
            'Do not claim an email was sent. This output is draft text only and requires Human Executive approval before any Gmail draft or send workflow proceeds.',
          ].join(' '),
          maxOutputTokens: 500,
          temperature: 0.1,
        },
      });

      if (response.status === 'blocked' || response.status === 'failed') {
        throw new Error(`Finance governed communication model integration ${response.integrationId} returned ${response.status}.`);
      }

      return {
        policy,
        draftText: response.output.text,
        model: response.output.model,
        provider: response.provider,
        integrationId: response.integrationId,
        modelEvidenceReferences: response.evidenceReferences,
        humanApprovalRequired: true as const,
        sendAuthorised: false as const,
      };
    },
  };
}
