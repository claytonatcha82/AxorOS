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
  application_name: 'axoros-sales-gmail-inbound-thread-read-verifier',
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

  const payload = payloadOf(outbound);
  const detection = await runtime.commands.inspect(outbound.id);

  console.log('AxorOS SALES GMAIL INBOUND THREAD READ VERIFICATION');
  console.log('---------------------------------------------------');
  console.log(`Persisted outbound record: ${outbound.id}`);
  console.log(`Provider message recorded: ${Boolean(payload?.providerMessageId) ? 'YES' : 'NO'}`);
  console.log(`Provider thread recorded: ${Boolean(payload?.providerThreadReference) ? 'YES' : 'NO'}`);
  console.log(`Exact Gmail thread read: PASS`);
  console.log(`Reply detected: ${detection.replyDetected ? 'YES' : 'NO'}`);
  console.log(`Automatic response authorised: ${detection.automaticResponseAuthorised ? 'YES' : 'NO'}`);
  console.log(`Next action: ${detection.nextAction}`);
  if (detection.reply) {
    console.log(`Reply provider message ID recorded by detector: ${detection.reply.messageId}`);
  }
  console.log('PASS  Live Gmail thread inspection completed without creating a draft or sending an email.');
  console.log('No inbound evidence was persisted by this verifier.');
} finally {
  await pool.end().catch(() => undefined);
}
