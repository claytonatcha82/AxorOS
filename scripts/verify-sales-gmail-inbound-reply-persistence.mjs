import pg from 'pg';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';
import { createPersistedSalesInboundReplyRuntime } from '../apps/api/dist/services/sales-inbound-reply-runtime.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL?.trim();
const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();

if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required via Infisical.');
if (!clientId || !clientSecret || !refreshToken || !identitiesJson) {
  throw new Error('Complete AXOROS_GMAIL_* configuration is required via Infisical.');
}

let identityAddresses;
try {
  identityAddresses = JSON.parse(identitiesJson);
} catch {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.');
}
const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) throw new Error('A configured Sales Gmail identity is required.');

function payloadOf(event) {
  return event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : undefined;
}

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: 'axoros-sales-gmail-inbound-reply-persistence-verifier',
});

try {
  const configured = createConfiguredIntegrationRegistry({
    environment: 'development',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
    databaseUrl: connectionString,
    gmailClientId: clientId,
    gmailClientSecret: clientSecret,
    gmailRefreshToken: refreshToken,
    gmailIdentityAddresses: identityAddresses,
  });
  if (!configured.gmailIntegration) throw new Error('Configured Gmail integration is unavailable.');

  const runtime = createPersistedSalesInboundReplyRuntime(pool, configured.gmailIntegration);
  const events = await runtime.repository.listWorkflowEvents(200);
  const outbound = events.find((event) => {
    if (event.eventType !== 'sales_supervised_email_sent') return false;
    const payload = payloadOf(event);
    return payload?.recipientEmail === salesAddress
      && payload?.subject === '[AxorOS TEST] Governed supervised Sales self-send verification'
      && typeof payload?.providerMessageId === 'string'
      && typeof payload?.providerThreadReference === 'string';
  });
  if (!outbound) throw new Error('No persisted governed Sales self-send record with Gmail thread correlation was found.');

  console.log('AxorOS SALES GMAIL INBOUND REPLY PERSISTENCE VERIFICATION');
  console.log('---------------------------------------------------------');
  console.log(`Persisted outbound record: ${outbound.id}`);

  const result = await runtime.commands.inspectAndPersist(outbound.id);
  if (!result.replyDetected || !result.evidenceRecorded || !result.providerMessageId) {
    throw new Error('No qualifying external reply was detected and persisted. Reply to the governed self-send first.');
  }
  if (result.automaticResponseAuthorised !== false) {
    throw new Error('SAFETY BLOCK: inbound evidence persistence unexpectedly authorised an automatic response.');
  }

  const persisted = await pool.query(
    `select outbound_record_id, lead_id, provider_thread_reference, provider_message_id, sender_address, recipient_address, subject, provider_internal_date, snippet, text_body, recorded_at
       from operational.sales_inbound_reply_evidence
      where provider_message_id = $1
      limit 1`,
    [result.providerMessageId],
  );
  if (persisted.rowCount !== 1) throw new Error('Inbound reply evidence was not found after persistence.');
  const row = persisted.rows[0];
  if (row.outbound_record_id !== outbound.id) throw new Error('Persisted inbound evidence is correlated to the wrong outbound record.');

  console.log('Reply detected: YES');
  console.log('Evidence persisted: YES');
  console.log(`Provider message ID: ${row.provider_message_id}`);
  console.log(`Provider thread correlation: ${row.provider_thread_reference ? 'YES' : 'NO'}`);
  console.log(`Outbound record correlation: ${row.outbound_record_id === outbound.id ? 'YES' : 'NO'}`);
  console.log(`Lead correlation: ${row.lead_id ? 'YES' : 'NO'}`);
  console.log(`Sender evidence recorded: ${row.sender_address ? 'YES' : 'NO'}`);
  console.log(`Subject evidence recorded: ${row.subject ? 'YES' : 'NO'}`);
  console.log(`Body/snippet evidence recorded: ${row.text_body || row.snippet ? 'YES' : 'NO'}`);
  console.log('Automatic response authorised: NO');
  console.log(`Next action: ${result.nextAction}`);
  console.log('PASS  Live Gmail inbound reply evidence was durably persisted.');
  console.log('No draft was created. No email was sent. No reply classification was performed.');
} finally {
  await pool.end().catch(() => undefined);
}
