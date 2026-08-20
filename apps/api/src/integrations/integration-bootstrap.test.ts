import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiConfig } from '../config.js';
import { createConfiguredIntegrationRegistry } from './integration-bootstrap.js';

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return { environment: 'test', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173', ...overrides };
}

test('configured registry always includes model and payment sandboxes and omits optional providers without credentials', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig());
  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox']);
  assert.equal(registry.get('model.sandbox')?.provider, 'axoros-sandbox');
  assert.equal(registry.get('payment.sandbox')?.provider, 'deterministic-payment-sandbox');
  assert.deepEqual(registry.require('payment.sandbox').supportedModes, ['sandbox']);
  assert.deepEqual(registry.require('payment.sandbox').supportedOperations, ['verify_payment']);
  assert.equal(registry.get('payment.paystack'), undefined);
  assert.equal(registry.get('model.gemini'), undefined);
  assert.equal(registry.get('email.gmail'), undefined);
  assert.equal(registry.get('research.google-places'), undefined);
  assert.equal(registry.get('research.tavily-web'), undefined);
});

test('configured registry registers Paystack test verification only in sandbox mode', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({ paystackSecretKey: 'sk_test_example-secret' }));
  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'payment.paystack']);
  const paystack = registry.require('payment.paystack');
  assert.equal(paystack.provider, 'paystack');
  assert.deepEqual(paystack.supportedModes, ['sandbox']);
  assert.deepEqual(paystack.supportedOperations, ['verify_payment']);
});

test('configured registry registers Paystack live verification only in live mode', () => {
  const { registry } = createConfiguredIntegrationRegistry(baseConfig({ paystackSecretKey: 'sk_live_example-secret' }));
  assert.deepEqual(registry.require('payment.paystack').supportedModes, ['live']);
});

test('configured registry registers Gemini only when a key is configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({ geminiApiKey: 'test-secret', geminiModel: 'gemini-test-model' }));
  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'model.gemini']);
  assert.equal(registry.require('model.gemini').provider, 'google-gemini');
  assert.deepEqual(registry.require('model.gemini').supportedModes, ['draft']);
});

test('configured registry registers Gmail as draft-only when complete credentials are configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({ gmailClientId: 'client-id', gmailClientSecret: 'client-secret', gmailRefreshToken: 'refresh-token', gmailIdentityAddresses: { sales: 'sales@example.test' } }));
  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'email.gmail']);
  const gmail = registry.require('email.gmail');
  assert.equal(gmail.provider, 'google-gmail');
  assert.deepEqual(gmail.supportedModes, ['draft']);
  assert.deepEqual(gmail.supportedOperations, ['create_draft']);
});

test('configured registry exposes supervised Sales Gmail send only when the explicit flag is enabled', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    gmailClientId: 'client-id',
    gmailClientSecret: 'client-secret',
    gmailRefreshToken: 'refresh-token',
    gmailIdentityAddresses: { sales: 'sales@example.test' },
    gmailSupervisedSalesSendEnabled: true,
  }));

  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'email.gmail']);
  const gmail = registry.require('email.gmail');
  assert.deepEqual(gmail.supportedModes, ['draft', 'live']);
  assert.deepEqual(gmail.supportedOperations, ['create_draft', 'send_email']);
});

test('configured registry keeps supervised Gmail live execution blocked when explicit flag is absent', async () => {
  const { registry } = createConfiguredIntegrationRegistry(baseConfig({
    gmailClientId: 'client-id',
    gmailClientSecret: 'client-secret',
    gmailRefreshToken: 'refresh-token',
    gmailIdentityAddresses: { sales: 'sales@example.test' },
  }));

  await assert.rejects(
    () => registry.execute({
      integrationId: 'email.gmail',
      operation: 'send_email',
      requestedBy: 'sales_agent',
      executionId: 'exec-disabled',
      correlationId: 'corr-disabled',
      mode: 'live',
      risk: 'medium',
      idempotencyKey: 'sales-supervised-email-send:gate-disabled',
      input: {},
    }),
    /live integration execution is disabled by policy/,
  );
});

test('configured registry scopes supervised Gmail live policy to send_email at medium risk', async () => {
  const { registry } = createConfiguredIntegrationRegistry(baseConfig({
    gmailClientId: 'client-id',
    gmailClientSecret: 'client-secret',
    gmailRefreshToken: 'refresh-token',
    gmailIdentityAddresses: { sales: 'sales@example.test' },
    gmailSupervisedSalesSendEnabled: true,
  }));

  await assert.rejects(
    () => registry.execute({
      integrationId: 'email.gmail',
      operation: 'send_email',
      requestedBy: 'sales_agent',
      executionId: 'exec-high-risk',
      correlationId: 'corr-high-risk',
      mode: 'live',
      risk: 'high',
      idempotencyKey: 'sales-supervised-email-send:gate-high-risk',
      input: {},
    }),
    /exceeds policy ceiling medium/,
  );

  await assert.rejects(
    () => registry.execute({
      integrationId: 'research.google-places',
      operation: 'search_businesses',
      requestedBy: 'lead_agent',
      executionId: 'exec-research',
      correlationId: 'corr-research',
      mode: 'live',
      risk: 'low',
      input: {},
    }),
    /live integration execution is disabled by policy/,
  );
});

test('configured registry registers Google Places as live read-only research when a key is configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({ googlePlacesApiKey: 'google-places-key' }));
  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'research.google-places']);
  const places = registry.require('research.google-places');
  assert.equal(places.provider, 'google-places');
  assert.deepEqual(places.supportedModes, ['live']);
  assert.deepEqual(places.supportedOperations, ['search_businesses']);
});

test('configured registry registers Tavily as live read-only public web research when a key is configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({ tavilyApiKey: 'tvly-test-key' }));
  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'research.tavily-web']);
  const tavily = registry.require('research.tavily-web');
  assert.equal(tavily.provider, 'tavily');
  assert.deepEqual(tavily.supportedModes, ['live']);
  assert.deepEqual(tavily.supportedOperations, ['search_public_web']);
});
