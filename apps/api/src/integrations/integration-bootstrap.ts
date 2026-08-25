import type { ApiConfig } from '../config.js';
import { createAnthropicModelIntegration } from './anthropic-model-integration.js';
import { createCloudflareDeploymentIntegration } from './cloudflare-deployment-integration.js';
import { createCloudflareProjectProvisioningIntegration } from './cloudflare-project-provisioning-integration.js';
import { createCloudflareRollbackIntegration } from './cloudflare-rollback-integration.js';
import { DeterministicPaymentIntegration } from './deterministic-payment-integration.js';
import { createGeminiModelIntegration } from './gemini-model-integration.js';
import { createGmailDraftIntegration, type GmailEmailIntegration } from './gmail-draft-integration.js';
import { createGooglePlacesLeadResearchIntegration } from './google-places-lead-research-integration.js';
import { IntegrationRegistry, type LiveIntegrationExecutionGate } from './integration-registry.js';
import type { IntegrationExecutionPolicy, ScopedLiveIntegrationRule } from './integration-policy.js';
import { createOpenAIModelIntegration } from './openai-model-integration.js';
import { createPaystackPaymentIntegration } from './paystack-payment-integration.js';
import { createPaystackPaymentRequestIntegration } from './paystack-payment-request-integration.js';
import { createSandboxModelIntegration } from './sandbox-model-integration.js';
import { createTavilyPublicWebResearchIntegration } from './tavily-public-web-research-integration.js';

export interface IntegrationBootstrapResult {
  registry: IntegrationRegistry;
  registeredIntegrationIds: readonly string[];
  gmailIntegration?: GmailEmailIntegration;
}

export interface IntegrationBootstrapOptions {
  liveExecutionGate?: LiveIntegrationExecutionGate;
}

function integrationPolicy(config: ApiConfig): IntegrationExecutionPolicy {
  const scopedLiveRules: ScopedLiveIntegrationRule[] = [];

  if (config.googlePlacesApiKey) {
    scopedLiveRules.push({ integrationId: 'research.google-places', operation: 'search_businesses', riskCeiling: 'low' });
  }
  if (config.tavilyApiKey) {
    scopedLiveRules.push({ integrationId: 'research.tavily-web', operation: 'search_public_web', riskCeiling: 'low' });
  }
  if (config.gmailSupervisedSalesSendEnabled) {
    scopedLiveRules.push({ integrationId: 'email.gmail', operation: 'send_email', riskCeiling: 'medium' });
  }
  if (config.paymentIntegrationMode === 'live' && config.paystackSecretKey) {
    scopedLiveRules.push(
      { integrationId: 'payment.paystack', operation: 'verify_payment', riskCeiling: 'high' },
      { integrationId: 'payment.paystack.request', operation: 'initialize_payment_request', riskCeiling: 'medium' },
    );
  }
  if (config.deploymentIntegrationId === 'deployment.cloudflare' && config.cloudflareAccountId && config.cloudflareApiToken) {
    scopedLiveRules.push(
      { integrationId: 'deployment.cloudflare.project', operation: 'create_project', riskCeiling: 'high' },
      { integrationId: 'deployment.cloudflare.rollback', operation: 'rollback_production', riskCeiling: 'critical' },
    );
  }

  return {
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    ...(scopedLiveRules.length > 0 ? { scopedLiveRules } : {}),
  };
}

export function createConfiguredIntegrationRegistry(
  config: ApiConfig,
  options: IntegrationBootstrapOptions = {},
): IntegrationBootstrapResult {
  const registry = new IntegrationRegistry(integrationPolicy(config), options.liveExecutionGate);
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

    const paystackPaymentRequest = createPaystackPaymentRequestIntegration({ secretKey: config.paystackSecretKey });
    registry.register(paystackPaymentRequest);
    registeredIntegrationIds.push(paystackPaymentRequest.integrationId);
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

  if (config.anthropicApiKey && config.anthropicModel) {
    const anthropic = createAnthropicModelIntegration({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
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

  if (config.deploymentIntegrationId === 'deployment.cloudflare' && config.cloudflareAccountId && config.cloudflareApiToken) {
    const cloudflare = createCloudflareDeploymentIntegration({
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
    });
    registry.register(cloudflare);
    registeredIntegrationIds.push(cloudflare.integrationId);

    const cloudflareProject = createCloudflareProjectProvisioningIntegration({
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
    });
    registry.register(cloudflareProject);
    registeredIntegrationIds.push(cloudflareProject.integrationId);

    const cloudflareRollback = createCloudflareRollbackIntegration({
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
    });
    registry.register(cloudflareRollback);
    registeredIntegrationIds.push(cloudflareRollback.integrationId);
  }

  return {
    registry,
    registeredIntegrationIds,
    ...(gmailIntegration ? { gmailIntegration } : {}),
  };
}
