import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({
  connectionString,
  application_name: 'axoros-sales-outreach-suppression-verifier',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const leadId = `sales-suppression:verify:${suffix}`;
const recipientAddress = `sales-suppression-${suffix}@example.invalid`;
const inboundEvidenceId = `sales-inbound-evidence:verify:${suffix}`;
const providerMessageId = `sales-provider-message:verify:${suffix}`;

try {
  await client.connect();
  await client.query('begin');

  const inserted = await client.query(
    `insert into operational.sales_outreach_suppressions
       (lead_id, recipient_address, reason, source_inbound_evidence_id, source_provider_message_id)
     values ($1,$2,'explicit_opt_out',$3,$4)
     returning lead_id, recipient_address, reason, source_inbound_evidence_id,
               source_provider_message_id, active, suppressed_at`,
    [leadId, recipientAddress, inboundEvidenceId, providerMessageId],
  );

  const row = inserted.rows[0];
  if (!row) throw new Error('Suppression insert returned no row.');
  if (row.lead_id !== leadId) throw new Error('Lead correlation was not preserved.');
  if (row.recipient_address !== recipientAddress) throw new Error('Recipient correlation was not preserved.');
  if (row.reason !== 'explicit_opt_out') throw new Error('Suppression reason was not preserved.');
  if (row.source_inbound_evidence_id !== inboundEvidenceId) throw new Error('Inbound evidence provenance was not preserved.');
  if (row.source_provider_message_id !== providerMessageId) throw new Error('Provider message provenance was not preserved.');
  if (row.active !== true) throw new Error('Suppression was not active.');

  const lookup = await client.query(
    `select exists (
       select 1 from operational.sales_outreach_suppressions
       where lower(recipient_address) = lower($1) and active = true
     ) as active`,
    [recipientAddress.toUpperCase()],
  );
  if (lookup.rows[0]?.active !== true) throw new Error('Normalized active-recipient lookup failed.');

  const replay = await client.query(
    `insert into operational.sales_outreach_suppressions
       (lead_id, recipient_address, reason, source_inbound_evidence_id, source_provider_message_id)
     values ($1,$2,'explicit_opt_out',$3,$4)
     on conflict do nothing
     returning id`,
    [leadId, recipientAddress, inboundEvidenceId, providerMessageId],
  );
  if (replay.rows.length !== 0) throw new Error('Replay protection did not reject duplicate suppression evidence.');

  console.log(`Lead correlation: ${row.lead_id}`);
  console.log(`Recipient suppression: ${row.recipient_address}`);
  console.log(`Reason: ${row.reason}`);
  console.log(`Inbound evidence provenance: ${row.source_inbound_evidence_id}`);
  console.log(`Provider message provenance: ${row.source_provider_message_id}`);
  console.log(`Active: ${row.active ? 'YES' : 'NO'}`);
  console.log('Normalized recipient lookup: YES');
  console.log('Replay protection: YES');
  console.log('PASS  Durable Sales outreach suppression persistence verified.');

  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
