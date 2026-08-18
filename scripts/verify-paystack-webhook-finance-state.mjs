import pg from 'pg';

const { Client } = pg;
const reference = process.argv[2]?.trim();
if (!reference) {
  throw new Error('Usage: npm run paystack:test:webhook:verify:dev -- <AXOROS-STAGE1-reference>');
}
if (!reference.startsWith('AXOROS-STAGE1-')) {
  throw new Error('Expected an AXOROS-STAGE1- test transaction reference.');
}

const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required. Inject it with Infisical.');

const client = new Client({
  connectionString,
  application_name: 'axoros-paystack-webhook-finance-state-verify',
});

try {
  await client.connect();

  const webhook = await client.query(
    `select provider, provider_event_reference, provider_payment_reference, event_type,
            commercial_record_reference, amount_minor, currency, evidence_reference, occurred_at
       from finance.payment_webhook_events
      where provider = 'paystack' and provider_payment_reference = $1
      order by received_at desc
      limit 1`,
    [reference],
  );
  if (webhook.rowCount !== 1) throw new Error(`No persisted Paystack webhook event found for ${reference}.`);
  const event = webhook.rows[0];
  if (event.event_type !== 'payment_paid') throw new Error(`Expected payment_paid webhook event, received ${event.event_type}.`);
  if (Number(event.amount_minor) !== 100 || event.currency !== 'ZAR') {
    throw new Error(`Webhook amount/currency mismatch: ${event.amount_minor} ${event.currency}.`);
  }

  const state = await client.query(
    `select payment_status, authority_state, latest_event_type, commercial_record_reference,
            amount_minor, currency, latest_evidence_reference
       from finance.payment_current_state
      where provider = 'paystack' and provider_payment_reference = $1`,
    [reference],
  );
  if (state.rowCount !== 1) throw new Error(`No authoritative Finance payment state found for ${reference}.`);
  const current = state.rows[0];
  if (current.payment_status !== 'CONFIRMED' || current.authority_state !== 'AUTHORIZED') {
    throw new Error(`Expected CONFIRMED/AUTHORIZED Finance state, received ${current.payment_status}/${current.authority_state}.`);
  }
  if (current.latest_event_type !== 'payment_paid') throw new Error(`Expected latest payment_paid state, received ${current.latest_event_type}.`);
  if (Number(current.amount_minor) !== 100 || current.currency !== 'ZAR') {
    throw new Error(`Finance current-state amount/currency mismatch: ${current.amount_minor} ${current.currency}.`);
  }

  const clearance = await client.query(
    `select clearance_id, state, commercial_record_reference, provider_payment_reference,
            amount_minor, currency, evidence_references
       from finance.clearance_decisions
      where provider_payment_reference = $1
      order by created_at desc
      limit 1`,
    [reference],
  );
  if (clearance.rowCount !== 1) throw new Error(`No persisted Finance clearance found for ${reference}.`);
  const decision = clearance.rows[0];
  if (decision.state !== 'FINANCE_CLEARED') throw new Error(`Expected FINANCE_CLEARED, received ${decision.state}.`);
  if (Number(decision.amount_minor) !== 100 || decision.currency !== 'ZAR') {
    throw new Error(`Finance clearance amount/currency mismatch: ${decision.amount_minor} ${decision.currency}.`);
  }
  if (decision.commercial_record_reference !== event.commercial_record_reference || current.commercial_record_reference !== event.commercial_record_reference) {
    throw new Error('Commercial record identity does not match across webhook evidence, Finance clearance, and current state.');
  }

  const evidence = Array.isArray(decision.evidence_references) ? decision.evidence_references : [];
  if (!evidence.some((value) => typeof value === 'string' && value.startsWith('payment-provider:paystack:'))) {
    throw new Error('Finance clearance is missing persisted Paystack webhook evidence.');
  }
  if (!evidence.some((value) => typeof value === 'string' && value.startsWith('payment-paystack-verify:transaction:'))) {
    throw new Error('Finance clearance is missing independent Paystack verification evidence.');
  }

  console.log('PASS Paystack signed webhook was persisted by AxorOS');
  console.log('PASS Finance independently verified the Paystack payment');
  console.log('PASS Finance current state is CONFIRMED / AUTHORIZED');
  console.log('PASS Webhook evidence and independent verification are bound to the same Finance clearance');
  console.log(`Reference: ${reference}`);
  console.log(`Commercial record: ${event.commercial_record_reference}`);
  console.log(`Provider event: ${event.provider_event_reference}`);
  console.log(`Clearance: ${decision.clearance_id}`);
  console.log('No real money was moved.');
} finally {
  await client.end().catch(() => undefined);
}
