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
if (paymentIntegration === 'paystack') {
  const paystackSecretKey = process.env.AXOROS_PAYSTACK_SECRET_KEY?.trim();
  if (!paystackSecretKey) {
    failures += 1;
    console.error('FAIL  AXOROS_PAYSTACK_SECRET_KEY is missing while Paystack is active');
  } else if (!paystackSecretKey.startsWith('sk_test_')) {
    failures += 1;
    console.error('FAIL  Stage 1 Paystack configuration must use an sk_test_ key');
  } else {
    console.log('PASS  Paystack Stage 1 test secret is present and uses the sk_test_ prefix');
  }
} else if (paymentIntegration && paymentIntegration !== 'sandbox') {
  failures += 1;
  console.error('FAIL  AXOROS_PAYMENT_INTEGRATION must be sandbox or paystack');
} else {
  console.log('PASS  Payment integration remains sandbox unless Paystack is explicitly activated');
}

if (failures > 0) {
  console.error(`\nSecret validation failed: ${failures} required secret/configuration issue(s).`);
  process.exitCode = 1;
} else {
  console.log('\nSecret validation passed.');
}
