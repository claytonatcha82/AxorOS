import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is required. Inject it with Infisical; do not paste it into source code or chat.');
}

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  openaiApiKey: apiKey,
  ...(process.env.AXOROS_OPENAI_MODEL?.trim() ? { openaiModel: process.env.AXOROS_OPENAI_MODEL.trim() } : {}),
});

if (!registeredIntegrationIds.includes('model.openai')) {
  throw new Error('OpenAI integration was not registered. Check OPENAI_API_KEY injection.');
}

const executionId = `openai-smoke-${Date.now()}`;
const response = await registry.execute({
  integrationId: 'model.openai',
  operation: 'generate_text',
  requestedBy: 'sales_agent',
  executionId,
  correlationId: executionId,
  mode: 'draft',
  risk: 'low',
  input: {
    systemInstruction: 'You are participating in a synthetic AxorOS connectivity test. Do not request, infer, or output sensitive data.',
    prompt: 'Reply with exactly: AXOROS_OPENAI_SMOKE_OK',
    maxOutputTokens: 32,
  },
});

if (response.status !== 'drafted') {
  throw new Error(`OpenAI smoke test failed with status ${response.status}; evidence=${response.evidenceReferences.join(',')}`);
}

const actual = response.output.text.trim();
if (actual !== 'AXOROS_OPENAI_SMOKE_OK') {
  throw new Error(`OpenAI smoke test returned unexpected output: ${JSON.stringify(actual)}`);
}

console.log('PASS OpenAI provider connectivity');
console.log(`Provider: ${response.provider}`);
console.log(`Model: ${response.output.model}`);
console.log(`Mode: ${response.mode}`);
console.log(`Input tokens: ${response.output.inputTokens ?? 'not reported'}`);
console.log(`Output tokens: ${response.output.outputTokens ?? 'not reported'}`);
console.log('No client data was used.');
