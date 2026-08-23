import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';
import { buildFinanceAdvisoryContext } from './finance-advisory-context.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

export interface FinanceGovernedAdvisoryServiceDependencies {
  integrations: IntegrationRegistry;
  integrationId?: string;
}

export interface FinanceGovernedAdvisoryInput {
  executionId: string;
  correlationId: string;
  decision: FinanceGovernedOperationalDecision;
}

export function createFinanceGovernedAdvisoryService(
  dependencies: FinanceGovernedAdvisoryServiceDependencies,
) {
  const integrationId = dependencies.integrationId ?? 'model.gemini';

  return {
    async advise(input: FinanceGovernedAdvisoryInput) {
      if (!input.decision.advisoryModelAllowed) {
        throw new Error('Finance deterministic decision does not permit advisory model use.');
      }

      const advisory = buildFinanceAdvisoryContext(input.decision);
      const response = await dependencies.integrations.execute<ModelGenerationInput, ModelGenerationOutput>({
        integrationId,
        operation: 'generate_text',
        requestedBy: 'finance_agent',
        executionId: input.executionId,
        correlationId: input.correlationId,
        mode: 'draft',
        risk: 'low',
        input: {
          prompt: advisory.financeBrief,
          context: advisory.financeContext,
          systemInstruction: [
            'You are the AxorOS Finance Agent providing advisory analysis only.',
            'The deterministic Finance operational decision in context is authoritative and immutable for this response.',
            'Never claim that your analysis changes payment state, clearance, requirement satisfaction, gate authority, ledger state, or money movement.',
            'Do not infer successful payment beyond the authoritative state supplied in context.',
            'Return concise operational guidance, reconciliation follow-up, anomaly observations, or safe client-communication guidance only.',
          ].join(' '),
          maxOutputTokens: 700,
          temperature: 0.1,
        },
      });

      if (response.status === 'blocked' || response.status === 'failed') {
        throw new Error(`Finance advisory model integration ${response.integrationId} returned ${response.status}.`);
      }

      return {
        decision: input.decision,
        advisoryText: response.output.text,
        model: response.output.model,
        provider: response.provider,
        integrationId: response.integrationId,
        evidenceReferences: response.evidenceReferences,
        knowledgeReferences: advisory.knowledgeReferences,
      };
    },
  };
}
