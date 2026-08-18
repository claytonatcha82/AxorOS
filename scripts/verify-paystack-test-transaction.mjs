import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const reference = process.argv[2]?.trim();
if (!reference) throw new Error('Pass the Paystack transaction reference as the first argument.');
if (!/^AXOROS-STAGE1-[A-Za-z0-9.-]+$/.test(reference)) {
  throw new Error('Unexpected Paystack test transaction reference format.');
}

const secretKey = process.env.AXOROS_PAYSTACK_SECRET_KEY?.trim();
if (!secretKey) throw new Error('AXOROS_PAYSTACK_SECRET_KEY is required via Infisical.');
if (!secretKey.startsWith('sk_test_')) throw new Error('Only a Paystack sk_test_ key is permitted for this Stage 1 transaction verifier.');
if (process.env.AXOROS_PAYMENT_INTEGRATION?.trim() !== 'paystack') {
  throw new Error('AXOROS_PAYMENT_INTEGRATION must be exactly paystack.');
}

const commercialRecordReference = `commercial:${reference}`;
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
  throw new Error('Paystack integration was not registered.');
}

const executionId = `paystack-stage1-verify-${Date.now()}`;
const result = await registry.execute({
  integrationId: 'payment.paystack',
  operation: 'verify_payment',
  requestedBy: 'finance_agent',
  executionId,
  correlationId: executionId,
  mode: 'sandbox',
  risk: 'high',
  input: {
    providerPaymentReference: reference,
    commercialRecordReference,
    expectedAmountMinor: 100,
    currency: 'ZAR',
  },
  idempotencyKey: `paystack-stage1-manual-verify:${reference}`,
});

if (result.status !== 'succeeded') {
  throw new Error(`Paystack verification request failed with status ${result.status}.`);
}
if (result.output.providerPaymentReference !== reference) {
  throw new Error('Paystack verification returned a different transaction reference.');
}
if (result.output.verificationStatus !== 'verified_paid') {
  throw new Error(`Paystack transaction is not verified paid; provider status normalized to ${result.output.verificationStatus}.`);
}
if (result.output.amountMinor !== 100 || result.output.currency !== 'ZAR') {
  throw new Error('Paystack verified transaction amount or currency does not match the controlled Stage 1 test transaction.');
}

console.log('PASS Paystack test transaction independently verified by AxorOS');
console.log(`Reference: ${reference}`);
console.log(`Commercial record: ${commercialRecordReference}`);
console.log(`Verification status: ${result.output.verificationStatus}`);
console.log(`Amount: ZAR ${(result.output.amountMinor / 100).toFixed(2)}`);
console.log(`Provider evidence: ${result.evidenceReferences.join(', ') || 'none'}`);
console.log('No real money was moved.');
