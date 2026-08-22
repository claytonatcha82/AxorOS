import type { ApiConfig } from '../config.js';
import { createAnthropicModelIntegration } from './anthropic-model-integration.js';
import { DeterministicPaymentIntegration } from './deterministic-payment-integration.js';
import { createGeminiModelIntegration } from './gemini-model-integration.js';
import { createGmailDraftIntegration, type GmailEmailIntegration } from './gmail-draft-integration.js';
import { createGooglePlacesLeadResearchIntegration } from './google-places-lead-research-integration.js';
import { IntegrationRegistry } from './integration-registry.js';
import type { IntegrationExecutionPolicy } from './integration-policy.js';
import { createOpenAIModelIntegration } from './openai-model-integration.js';
import { createPaystackPaymentIntegration } from './paystack-payment-integration.js';
import { createSandboxModelIntegration } from './sandbox-model-integration.js';
import { createTavilyPublicWebResearchIntegration } from './tavily-public-web-research-integration.js';

export interface IntegrationBootstrapResult {
  registry: IntegrationRegistry;
  registeredIntegrationIds: readonly string[];
  gmailIntegration?: GmailEmailIntegration;
}

function integrationPolicy(config: ApiConfig): IntegrationExecutionPolicy {
  return {
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    ...(config.gmailSupervisedSalesSendEnabled
      ? {
          scopedLiveRules: [{
            integrationId: 'email.gmail',
            operation: 'send_email',
            riskCeiling: 'medium' as const,
          }],
        }
      : {}),
  };
}

export function createConfiguredIntegrationRegistry(config: ApiConfig): IntegrationBootstrapResult {
  const registry = new IntegrationRegistry(integrationPolicy(config));
  const registeredIntegrationIds: string[] = [];
  let gmailIntegration: GmailEmailIntegration | undefined;

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

  if (config.openaiApiKey) {
    const openai = createOpenAIModelIntegration({
      apiKey: config.openaiApiKey,
      ...(config.openaiModel ? { model: config.openaiModel } : {}),
    });
    registry.register(openai);
    registeredIntegrationIds.push(openai.integrationId);
  }

  if (config.anthropicApiKey) {
    const anthropic = createAnthropicModelIntegration({
      apiKey: config.anthropicApiKey,
      ...(config.anthropicModel ? { model: config.anthropicModel } : {}),
    });
    registry.register(anthropic);
    registeredIntegrationIds.push(anthropic.integrationId);
  }

  if (config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken && config.gmailIdentityAddresses) {
    const gmail = createGmailDraftIntegration({
      clientId: config.gmailClientId,
      clientSecret: config.gmailClientSecret,
      refreshToken: config.gmailRefreshToken,
      identityAddresses: config.gmailIdentityAddresses,
      ...(config.gmailSupervisedSalesSendEnabled ? { allowSupervisedSalesSend: true } : {}),
    });
    registry.register(gmail);
    registeredIntegrationIds.push(gmail.integrationId);
    gmailIntegration = gmail;
  }

  if (config.googlePlacesApiKey) {
    const googlePlaces = createGooglePlacesLeadResearchIntegration({ apiKey: config.googlePlacesApiKey });
    registry.register(googlePlaces);
    registeredIntegrationIds.push(googlePlaces.integrationId);
  }

  if (config.tavilyApiKey) {
    const tavily = createTavilyPublicWebResearchIntegration({ apiKey: config.tavilyApiKey });
    registry.register(tavily);
    registeredIntegrationIds.push(tavily.integrationId);
  }

  return {
    registry,
    registeredIntegrationIds,
    ...(gmailIntegration ? { gmailIntegration } : {}),
  };
}
