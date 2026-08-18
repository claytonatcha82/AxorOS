import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const secretKey = process.env.AXOROS_PAYSTACK_SECRET_KEY?.trim();
if (!secretKey) {
  throw new Error('AXOROS_PAYSTACK_SECRET_KEY is required. Inject it with Infisical; do not paste it into source code or chat.');
}
if (!secretKey.startsWith('sk_test_')) {
  throw new Error('Stage 1 Paystack smoke verification requires an sk_test_ key. Live keys are not permitted.');
}
if (process.env.AXOROS_PAYMENT_INTEGRATION?.trim() !== 'paystack') {
  throw new Error('AXOROS_PAYMENT_INTEGRATION must be exactly paystack for this smoke verification.');
}

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  paystackSecretKey: secretKey,
  paymentIntegrationId: 'payment.paystack',
  paymentIntegrationMode: 'sandbox',
});

if (!registeredIntegrationIds.includes('payment.paystack')) {
  throw new Error('Paystack integration was not registered. Check AXOROS_PAYSTACK_SECRET_KEY injection.');
}

const integration = registry.require('payment.paystack');
if (integration.provider !== 'paystack') throw new Error('Registered payment provider is not Paystack.');
if (!integration.supportedModes.includes('sandbox')) throw new Error('Paystack test integration does not support sandbox mode.');
if (integration.supportedModes.includes('live')) throw new Error('Stage 1 Paystack integration unexpectedly permits live mode with a test key.');

const response = await fetch('https://api.paystack.co/bank?country=south africa&perPage=1', {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${secretKey}`,
    Accept: 'application/json',
  },
});

let payload;
try {
  payload = await response.json();
} catch {
  throw new Error(`Paystack connectivity returned non-JSON HTTP ${response.status}.`);
}

if (!response.ok || payload?.status !== true) {
  const providerMessage = typeof payload?.message === 'string' ? payload.message : 'no provider message';
  throw new Error(`Paystack test-mode connectivity failed: HTTP ${response.status}; ${providerMessage}`);
}

console.log('PASS Paystack test-mode provider connectivity');
console.log('PASS payment.paystack is registered in sandbox mode');
console.log('PASS live mode is not enabled by the injected test key');
console.log('No transaction was created and no money was moved.');
