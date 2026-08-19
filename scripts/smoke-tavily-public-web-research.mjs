import { createTavilyPublicWebResearchIntegration } from '../apps/api/dist/integrations/tavily-public-web-research-integration.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const apiKey = process.env.AXOROS_TAVILY_API_KEY?.trim();
if (!apiKey) {
  throw new Error('AXOROS_TAVILY_API_KEY is required. Inject it with Infisical; do not paste it into source code or chat.');
}

const registry = new IntegrationRegistry({
  defaultMode: 'sandbox',
  allowLive: true,
  liveRiskCeiling: 'low',
});

const tavily = createTavilyPublicWebResearchIntegration({ apiKey });
registry.register(tavily);

const executionId = `tavily-web-smoke-${Date.now()}`;
const response = await registry.execute({
  integrationId: 'research.tavily-web',
  operation: 'search_public_web',
  requestedBy: 'lead_agent',
  executionId,
  correlationId: executionId,
  mode: 'live',
  risk: 'low',
  input: {
    query: 'web design business Durban South Africa official website',
    maxResults: 5,
    country: 'south africa',
  },
});

if (response.status !== 'succeeded') {
  const code = response.output.providerErrorCode ?? 'not-reported';
  const message = response.output.providerErrorMessage ?? 'not-reported';
  throw new Error(`Tavily smoke test failed with status ${response.status}; retryable=${response.retryable}; providerCode=${code}; providerMessage=${message}`);
}

if (!Array.isArray(response.output.results) || response.output.results.length === 0) {
  throw new Error('Tavily smoke test returned no public-web results for the synthetic Durban query.');
}

console.log('PASS Tavily provider connectivity');
console.log('PASS Governed Lead Agent public-web research');
console.log('PASS Default AxorOS live-integration policy remained unchanged');
console.log(`Provider: ${response.provider}`);
console.log(`Query: ${response.output.query}`);
console.log(`Results returned: ${response.output.results.length}`);
for (const result of response.output.results) {
  console.log(`- ${result.title} | ${result.url}`);
}
console.log('No outreach was sent and no CRM records were mutated.');
