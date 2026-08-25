import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import { validateIntegrationRequest } from './integration-contract.js';
import { enforceIntegrationPolicy, SAFE_INTEGRATION_POLICY, type IntegrationExecutionPolicy } from './integration-policy.js';

type AnyExternalIntegration = ExternalIntegration<unknown, unknown>;
export type LiveIntegrationExecutionGate = (request: IntegrationRequest) => Promise<void>;

export class IntegrationRegistry {
  private readonly integrations = new Map<string, AnyExternalIntegration>();

  constructor(
    private readonly policy: IntegrationExecutionPolicy = SAFE_INTEGRATION_POLICY,
    private readonly liveExecutionGate?: LiveIntegrationExecutionGate,
  ) {}

  register<TInput, TOutput>(integration: ExternalIntegration<TInput, TOutput>): void {
    if (!integration.integrationId.trim()) throw new Error('integrationId is required.');
    if (!integration.provider.trim()) throw new Error('integration provider is required.');
    if (integration.supportedModes.length === 0) throw new Error('integration must support at least one mode.');
    if (integration.supportedOperations.length === 0) throw new Error('integration must support at least one operation.');
    if (this.integrations.has(integration.integrationId)) {
      throw new Error(`integration already registered: ${integration.integrationId}.`);
    }
    this.integrations.set(integration.integrationId, integration as AnyExternalIntegration);
  }

  get(integrationId: string): AnyExternalIntegration | undefined {
    return this.integrations.get(integrationId);
  }

  require(integrationId: string): AnyExternalIntegration {
    const integration = this.get(integrationId);
    if (!integration) throw new Error(`integration is not registered: ${integrationId}.`);
    return integration;
  }

  async execute<TInput = Record<string, unknown>, TOutput = Record<string, unknown>>(
    request: IntegrationRequest<TInput>,
  ): Promise<IntegrationResponse<TOutput>> {
    const errors = validateIntegrationRequest(request as IntegrationRequest);
    if (errors.length) throw new Error(errors.join(' '));
    enforceIntegrationPolicy(request as IntegrationRequest, this.policy);
    if (request.mode === 'live' && this.liveExecutionGate) {
      await this.liveExecutionGate(request as IntegrationRequest);
    }

    const integration = this.require(request.integrationId);
    if (!integration.supportedModes.includes(request.mode)) {
      throw new Error(`integration ${request.integrationId} does not support mode ${request.mode}.`);
    }
    if (!integration.supportedOperations.includes(request.operation)) {
      throw new Error(`integration ${request.integrationId} does not support operation ${request.operation}.`);
    }

    const typedIntegration = integration as ExternalIntegration<TInput, TOutput>;
    return typedIntegration.execute(request);
  }
}