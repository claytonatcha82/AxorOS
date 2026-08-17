import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-payment-webhook-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'axoros-verification';
const eventRef = `evt-${suffix}`;
const paymentRef = `pay-${suffix}`;
const idempotencyKey = `payment-webhook:${provider}:${eventRef}`;
const evidenceReference = `payment-provider:${provider}:${eventRef}`;

try {
  await client.connect();
  await client.query('begin');
  const first = await client.query(
    `insert into finance.payment_webhook_events
       (idempotency_key, provider, provider_event_reference, provider_payment_reference, event_type,
        commercial_record_reference, amount_minor, currency, occurred_at, evidence_reference)
     values ($1,$2,$3,$4,'payment_paid',$5,100,'ZAR',now(),$6)
     on conflict do nothing returning id`,
    [idempotencyKey, provider, eventRef, paymentRef, `commercial:${suffix}`, evidenceReference],
  );
  const duplicate = await client.query(
    `insert into finance.payment_webhook_events
       (idempotency_key, provider, provider_event_reference, provider_payment_reference, event_type,
        commercial_record_reference, amount_minor, currency, occurred_at, evidence_reference)
     values ($1,$2,$3,$4,'payment_paid',$5,100,'ZAR',now(),$6)
     on conflict do nothing returning id`,
    [idempotencyKey, provider, eventRef, paymentRef, `commercial:${suffix}`, evidenceReference],
  );
  if (first.rowCount !== 1) throw new Error('first payment webhook event was not persisted.');
  if (duplicate.rowCount !== 0) throw new Error('duplicate payment webhook event was not suppressed.');
  await client.query('rollback');
  console.log('PASS  Payment webhook persistence and durable idempotency verified.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
