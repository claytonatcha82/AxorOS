const secretKey = process.env.AXOROS_PAYSTACK_SECRET_KEY?.trim();
if (!secretKey) throw new Error('AXOROS_PAYSTACK_SECRET_KEY is required via Infisical.');
if (!secretKey.startsWith('sk_test_')) throw new Error('Only a Paystack sk_test_ key is permitted for this Stage 1 transaction initializer.');
if (process.env.AXOROS_PAYMENT_INTEGRATION?.trim() !== 'paystack') {
  throw new Error('AXOROS_PAYMENT_INTEGRATION must be exactly paystack.');
}

const timestamp = Date.now();
const reference = `AXOROS-STAGE1-${timestamp}`;
const commercialRecordReference = `commercial:${reference}`;
const amountMinor = 100;
const currency = 'ZAR';
const email = 'axoros-paystack-test@example.com';

const response = await fetch('https://api.paystack.co/transaction/initialize', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({
    email,
    amount: String(amountMinor),
    currency,
    reference,
    channels: ['card'],
    metadata: JSON.stringify({
      axorosCommercialRecordReference: commercialRecordReference,
      axorosPurpose: 'stage1_test_transaction',
    }),
  }),
});

let payload;
try {
  payload = await response.json();
} catch {
  throw new Error(`Paystack initialization returned non-JSON HTTP ${response.status}.`);
}

if (!response.ok || payload?.status !== true || typeof payload?.data?.authorization_url !== 'string' || typeof payload?.data?.reference !== 'string') {
  const providerMessage = typeof payload?.message === 'string' ? payload.message : 'no provider message';
  throw new Error(`Paystack test transaction initialization failed: HTTP ${response.status}; ${providerMessage}`);
}

if (payload.data.reference !== reference) {
  throw new Error('Paystack returned a transaction reference different from the AxorOS-generated reference.');
}

console.log('PASS Paystack test transaction initialized');
console.log(`Reference: ${reference}`);
console.log(`Commercial record: ${commercialRecordReference}`);
console.log(`Amount: ZAR ${(amountMinor / 100).toFixed(2)}`);
console.log(`Checkout URL: ${payload.data.authorization_url}`);
console.log('This is Paystack TEST MODE. No real money will move.');
console.log('After completing the checkout, run: npm run paystack:test:transaction:verify:dev -- ' + reference);
