import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();

if (!clientId || !clientSecret || !refreshToken || !identitiesJson) {
  throw new Error(
    'All AXOROS_GMAIL_* settings are required. Inject them with Infisical; do not paste credentials into source code or chat.',
  );
}

let identityAddresses;
try {
  identityAddresses = JSON.parse(identitiesJson);
} catch {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.');
}

const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must contain a non-empty sales identity.');
}

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  gmailClientId: clientId,
  gmailClientSecret: clientSecret,
  gmailRefreshToken: refreshToken,
  gmailIdentityAddresses: identityAddresses,
});

if (!registeredIntegrationIds.includes('email.gmail')) {
  throw new Error('Gmail integration was not registered. Check AXOROS_GMAIL_* secret injection.');
}

const executionId = `gmail-draft-smoke-${Date.now()}`;
const response = await registry.execute({
  integrationId: 'email.gmail',
  operation: 'create_draft',
  requestedBy: 'sales_agent',
  executionId,
  correlationId: executionId,
  mode: 'draft',
  risk: 'low',
  input: {
    fromIdentity: 'sales',
    to: [{ email: salesAddress }],
    subject: '[AxorOS TEST] Gmail draft integration - DO NOT SEND',
    textBody:
      'This is a synthetic AxorOS Gmail integration test. No client or prospect data was used. This message was created as a Gmail draft only and must not be sent.',
  },
});

if (response.status !== 'drafted') {
  throw new Error(
    `Gmail draft smoke test failed with status ${response.status}; evidence=${response.evidenceReferences.join(',')}`,
  );
}

if (!response.output.draftId) {
  throw new Error('Gmail draft smoke test did not return a draft ID.');
}

console.log('PASS Gmail draft provider connectivity');
console.log(`Provider: ${response.provider}`);
console.log(`Mode: ${response.mode}`);
console.log(`Draft ID: ${response.output.draftId}`);
console.log('Recipient: authenticated Sales test mailbox');
console.log('No email was sent. No client or prospect data was used.');
console.log('Open Gmail Drafts and confirm the AxorOS TEST draft is present.');
