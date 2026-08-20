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
