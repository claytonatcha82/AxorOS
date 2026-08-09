const expected = process.argv[2];
const actual = process.env.AXOROS_ENV;

if (!expected) {
  console.error('FAIL  Expected environment argument is required.');
  process.exit(1);
}

if (!actual) {
  console.error('FAIL  AXOROS_ENV is not set.');
  process.exit(1);
}

if (actual !== expected) {
  console.error(`FAIL  AXOROS_ENV mismatch: expected ${expected}, received ${actual}`);
  process.exit(1);
}

console.log(`PASS  Secret environment matches AxorOS environment: ${actual}`);
