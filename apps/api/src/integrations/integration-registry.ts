import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import { validateIntegrationRequest } from './integration-contract.js';
import { enforceIntegrationPolicy, SAFE_INTEGRATION_POLICY, type IntegrationExecutionPolicy } from './integration-policy.js';

export class IntegrationRegistry {
  private readonly integrations = new Map<string, ExternalIntegration>();

  constructor(private readonly policy: IntegrationExecutionPolicy = SAFE_INTEGRATION_POLICY) {}

  register(integration: ExternalIntegration): void {
    if (!integration.integrationId.trim()) throw new Error('integrationId is required.');
    if (!integration.provider.trim()) throw new Error('integration provider is required.');
    if (integration.supportedModes.length === 0) throw new Error('integration must support at least one mode.');
    if (integration.supportedOperations.length === 0) throw new Error('integration must support at least one operation.');
    if (this.integrations.has(integration.integrationId)) {
      throw new Error(`integration already registered: ${integration.integrationId}.`);
    }
    this.integrations.set(integration.integrationId, integration);
  }

  get(integrationId: string): ExternalIntegration | undefined {
    return this.integrations.get(integrationId);
  }

  require(integrationId: string): ExternalIntegration {
    const integration = this.get(integrationId);
    if (!integration) throw new Error(`integration is not registered: ${integrationId}.`);
    return integration;
  }

  async execute(request: IntegrationRequest): Promise<IntegrationResponse> {
    const errors = validateIntegrationRequest(request);
    if (errors.length) throw new Error(errors.join(' '));
    enforceIntegrationPolicy(request, this.policy);

    const integration = this.require(request.integrationId);
    if (!integration.supportedModes.includes(request.mode)) {
      throw new Error(`integration ${request.integrationId} does not support mode ${request.mode}.`);
    }
    if (!integration.supportedOperations.includes(request.operation)) {
      throw new Error(`integration ${request.integrationId} does not support operation ${request.operation}.`);
    }

    return integration.execute(request);
  }
}
