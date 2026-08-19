import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const apiKey = process.env.AXOROS_GOOGLE_PLACES_API_KEY?.trim();
if (!apiKey) {
  throw new Error('AXOROS_GOOGLE_PLACES_API_KEY is required. Inject it with Infisical; do not paste it into source code or chat.');
}

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  googlePlacesApiKey: apiKey,
});

if (!registeredIntegrationIds.includes('research.google-places')) {
  throw new Error('Google Places research integration was not registered. Check AXOROS_GOOGLE_PLACES_API_KEY injection.');
}

const executionId = `google-places-smoke-${Date.now()}`;
const response = await registry.execute({
  integrationId: 'research.google-places',
  operation: 'search_businesses',
  requestedBy: 'lead_agent',
  executionId,
  correlationId: executionId,
  mode: 'live',
  risk: 'low',
  input: {
    query: 'web design businesses in Durban, South Africa',
    maxResults: 5,
  },
});

if (response.status !== 'succeeded') {
  throw new Error(`Google Places smoke test failed with status ${response.status}; retryable=${response.retryable}`);
}

if (!Array.isArray(response.output.candidates) || response.output.candidates.length === 0) {
  throw new Error('Google Places smoke test returned no business candidates for the synthetic Durban query.');
}

console.log('PASS Google Places provider connectivity');
console.log('PASS Governed Lead Agent business discovery');
console.log(`Provider: ${response.provider}`);
console.log(`Query: ${response.output.query}`);
console.log(`Candidates returned: ${response.output.candidates.length}`);
for (const candidate of response.output.candidates) {
  console.log(`- ${candidate.displayName}${candidate.formattedAddress ? ` | ${candidate.formattedAddress}` : ''}`);
}
console.log('No outreach was sent and no CRM records were mutated.');
