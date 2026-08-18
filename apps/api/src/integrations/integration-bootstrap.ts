import type { ApiConfig } from '../config.js';
import { DeterministicPaymentIntegration } from './deterministic-payment-integration.js';
import { createGeminiModelIntegration } from './gemini-model-integration.js';
import { createGmailDraftIntegration } from './gmail-draft-integration.js';
import { IntegrationRegistry } from './integration-registry.js';
import { createPaystackPaymentIntegration } from './paystack-payment-integration.js';
import { createSandboxModelIntegration } from './sandbox-model-integration.js';

export interface IntegrationBootstrapResult {
  registry: IntegrationRegistry;
  registeredIntegrationIds: readonly string[];
}

export function createConfiguredIntegrationRegistry(config: ApiConfig): IntegrationBootstrapResult {
  const registry = new IntegrationRegistry();
  const registeredIntegrationIds: string[] = [];

  const sandbox = createSandboxModelIntegration();
  registry.register(sandbox);
  registeredIntegrationIds.push(sandbox.integrationId);

  const paymentSandbox = new DeterministicPaymentIntegration();
  registry.register(paymentSandbox);
  registeredIntegrationIds.push(paymentSandbox.integrationId);

  if (config.paystackSecretKey) {
    const paystack = createPaystackPaymentIntegration({ secretKey: config.paystackSecretKey });
    registry.register(paystack);
    registeredIntegrationIds.push(paystack.integrationId);
  }

  if (config.geminiApiKey) {
    const gemini = createGeminiModelIntegration({
      apiKey: config.geminiApiKey,
      ...(config.geminiModel ? { model: config.geminiModel } : {}),
    });
    registry.register(gemini);
    registeredIntegrationIds.push(gemini.integrationId);
  }

  if (config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken && config.gmailIdentityAddresses) {
    const gmail = createGmailDraftIntegration({
      clientId: config.gmailClientId,
      clientSecret: config.gmailClientSecret,
      refreshToken: config.gmailRefreshToken,
      identityAddresses: config.gmailIdentityAddresses,
    });
    registry.register(gmail);
    registeredIntegrationIds.push(gmail.integrationId);
  }

  return { registry, registeredIntegrationIds };
}
