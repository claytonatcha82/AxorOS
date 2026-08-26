import { spawnSync } from 'node:child_process';

const steps = [
  {
    label: 'Lead → Sales governed intake',
    script: 'scripts/verify-stage1-synthetic-lead-sales-lifecycle.mjs',
  },
  {
    label: 'Finance → Operations → Production governed lifecycle',
    script: 'scripts/verify-stage1-synthetic-finance-production-lifecycle.mjs',
  },
  {
    label: 'Deployment authority → PILOT_DISABLED kill switch',
    script: 'scripts/verify-stage1-synthetic-deployment-boundary.mjs',
  },
];

console.log('\nAxorOS Stage 1 — Consolidated Synthetic Lifecycle Audit');
console.log('=======================================================');
console.log('Runs the bounded Stage 1 verifiers sequentially.');
console.log('No real Gmail, Paystack, Cloudflare, or model side effects are authorised.\n');

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
  console.log('-'.repeat(72));

  const result = spawnSync(process.execPath, [step.script], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`FAIL  Could not execute ${step.script}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\nFAIL  Stage 1 audit stopped at: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n=======================================================');
console.log('PASS  Stage 1 consolidated synthetic lifecycle audit completed.');
console.log('PASS  Lead → Sales stayed governed and non-sending.');
console.log('PASS  Finance → Operations → Production preserved commercial authority.');
console.log('PASS  Strict deployment authority reached the global pilot boundary.');
console.log('PASS  PILOT_DISABLED prevented Cloudflare production network execution.\n');
