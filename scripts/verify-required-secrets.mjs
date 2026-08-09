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

if (failures > 0) {
  console.error(`\nSecret validation failed: ${failures} required secret(s) missing.`);
  process.exitCode = 1;
} else {
  console.log(`\nSecret validation passed: ${requiredSecrets.length} required secret(s) present.`);
}
