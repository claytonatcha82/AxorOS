const requiredSecrets = ['AXOROS_ENV', 'AXOROS_DATABASE_URL'];

let failures = 0;

for (const key of requiredSecrets) {
  const value = process.env[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    console.log(`PASS  ${key} is present`);
  } else {
    failures += 1;
    console.error(`FAIL  ${key} is missing`);
  }
}

const paymentIntegration = process.env.AXOROS_PAYMENT_INTEGRATION?.trim();
const axorosEnvironment = process.env.AXOROS_ENV?.trim();

if (paymentIntegration === 'paystack') {
  const paystackSecretKey = process.env.AXOROS_PAYSTACK_SECRET_KEY?.trim();

  if (!paystackSecretKey) {
    failures += 1;
    console.error('FAIL  AXOROS_PAYSTACK_SECRET_KEY is missing while Paystack is active');
  } else if (
    !paystackSecretKey.startsWith('sk_test_') &&
    !paystackSecretKey.startsWith('sk_live_')
  ) {
    failures += 1;
    console.error('FAIL  AXOROS_PAYSTACK_SECRET_KEY must be a Paystack test or live secret key');
  } else if (axorosEnvironment === 'production' && !paystackSecretKey.startsWith('sk_live_')) {
    failures += 1;
    console.error('FAIL  Production Paystack configuration requires an sk_live_ key');
  } else if (axorosEnvironment !== 'production' && !paystackSecretKey.startsWith('sk_test_')) {
    failures += 1;
    console.error('FAIL  Non-production Paystack configuration requires an sk_test_ key');
  } else if (paystackSecretKey.startsWith('sk_live_')) {
    console.log('PASS  Paystack production secret is present and uses the sk_live_ prefix');
  } else {
    console.log('PASS  Paystack non-production secret is present and uses the sk_test_ prefix');
  }
} else if (paymentIntegration && paymentIntegration !== 'sandbox') {
  failures += 1;
  console.error('FAIL  AXOROS_PAYMENT_INTEGRATION must be sandbox or paystack');
} else {
  console.log('PASS  Payment integration remains sandbox unless Paystack is explicitly activated');
}

const supervisedSalesSend = process.env.AXOROS_GMAIL_SUPERVISED_SALES_SEND?.trim();
if (supervisedSalesSend && supervisedSalesSend !== 'enabled' && supervisedSalesSend !== 'disabled') {
  failures += 1;
  console.error('FAIL  AXOROS_GMAIL_SUPERVISED_SALES_SEND must be enabled or disabled');
} else if (supervisedSalesSend === 'enabled') {
  const gmailRequiredSecrets = [
    'AXOROS_GMAIL_CLIENT_ID',
    'AXOROS_GMAIL_CLIENT_SECRET',
    'AXOROS_GMAIL_REFRESH_TOKEN',
    'AXOROS_GMAIL_IDENTITY_ADDRESSES',
  ];

  for (const key of gmailRequiredSecrets) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      console.log(`PASS  ${key} is present for supervised Sales Gmail sending`);
    } else {
      failures += 1;
      console.error(`FAIL  ${key} is missing while supervised Sales Gmail sending is enabled`);
    }
  }

  const rawIdentities = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();
  if (rawIdentities) {
    try {
      const identities = JSON.parse(rawIdentities);
      const validObject = identities && typeof identities === 'object' && !Array.isArray(identities);
      const salesIdentity = validObject ? identities.sales : undefined;
      if (typeof salesIdentity !== 'string' || !salesIdentity.trim()) {
        failures += 1;
        console.error('FAIL  AXOROS_GMAIL_IDENTITY_ADDRESSES must contain a non-empty sales identity');
      } else {
        console.log('PASS  Gmail sales identity is configured for supervised Sales sending');
      }
    } catch {
      failures += 1;
      console.error('FAIL  AXOROS_GMAIL_IDENTITY_ADDRESSES must contain valid JSON');
    }
  }

  console.log('PASS  Supervised Sales Gmail sending is explicitly enabled');
} else {
  console.log('PASS  Supervised Sales Gmail sending remains disabled unless explicitly enabled');
}

if (failures > 0) {
  console.error(`\nSecret validation failed: ${failures} required secret/configuration issue(s).`);
  process.exitCode = 1;
} else {
  console.log('\nSecret validation passed.');
}
