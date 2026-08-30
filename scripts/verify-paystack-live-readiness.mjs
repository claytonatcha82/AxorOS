import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const environment = process.env.AXOROS_ENV?.trim();
if (environment !== 'production') {
  throw new Error('Paystack live-readiness verification requires AXOROS_ENV=production.');
}

const paymentIntegration = process.env.AXOROS_PAYMENT_INTEGRATION?.trim();
if (paymentIntegration !== 'paystack') {
  throw new Error('AXOROS_PAYMENT_INTEGRATION must be exactly paystack for live readiness.');
}

const secretKey = process.env.AXOROS_PAYSTACK_SECRET_KEY?.trim();
if (!secretKey) {
  throw new Error('AXOROS_PAYSTACK_SECRET_KEY is required via Infisical; do not paste it into source code or chat.');
}
if (!secretKey.startsWith('sk_live_')) {
  throw new Error('Paystack live-readiness verification requires an sk_live_ key.');
}

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'production',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'https://control.example.invalid',
  paystackSecretKey: secretKey,
  paymentIntegrationId: 'payment.paystack',
  paymentIntegrationMode: 'live',
});

for (const integrationId of ['payment.paystack', 'payment.paystack.request']) {
  if (!registeredIntegrationIds.includes(integrationId)) {
    throw new Error(`${integrationId} was not registered with the production Paystack key.`);
  }
  const integration = registry.require(integrationId);
  if (integration.provider !== 'paystack') {
    throw new Error(`${integrationId} is not backed by Paystack.`);
  }
  if (!integration.supportedModes.includes('live')) {
    throw new Error(`${integrationId} does not advertise live mode with the injected production key.`);
  }
  if (integration.supportedModes.includes('sandbox')) {
    throw new Error(`${integrationId} unexpectedly advertises sandbox mode with the injected live key.`);
  }
}

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
  throw new Error(`Paystack live connectivity returned non-JSON HTTP ${response.status}.`);
}

if (!response.ok || payload?.status !== true) {
  const providerMessage = typeof payload?.message === 'string' ? payload.message : 'no provider message';
  throw new Error(`Paystack live-readiness connectivity failed: HTTP ${response.status}; ${providerMessage}`);
}

console.log('PASS Paystack production credential is an sk_live_ key');
console.log('PASS payment.paystack is registered in live mode');
console.log('PASS payment.paystack.request is registered in live mode');
console.log('PASS Paystack production API connectivity');
console.log('No transaction was created and no money was moved.');
