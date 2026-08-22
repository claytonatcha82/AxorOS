import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const model = process.env.AXOROS_ANTHROPIC_MODEL?.trim();
const productionModelIntegration = process.env.AXOROS_PRODUCTION_MODEL_INTEGRATION?.trim();

if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY is required. Inject it with Infisical; do not paste it into source code or chat.');
}
if (!model) {
  throw new Error('AXOROS_ANTHROPIC_MODEL is required.');
}
if (productionModelIntegration !== 'model.anthropic') {
  throw new Error('AXOROS_PRODUCTION_MODEL_INTEGRATION must be model.anthropic for the Production Anthropic smoke test.');
}

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  anthropicApiKey: apiKey,
  anthropicModel: model,
  productionModelIntegrationId: 'model.anthropic',
});

if (!registeredIntegrationIds.includes('model.anthropic')) {
  throw new Error('Anthropic integration was not registered. Check Anthropic configuration injection.');
}

const executionId = `anthropic-smoke-${Date.now()}`;
const response = await registry.execute({
  integrationId: 'model.anthropic',
  operation: 'generate_text',
  requestedBy: 'production_agent',
  executionId,
  correlationId: executionId,
  mode: 'draft',
  risk: 'low',
  input: {
    systemInstruction: 'You are participating in a synthetic AxorOS connectivity test. Do not request, infer, or output sensitive data.',
    prompt: 'Reply with exactly: AXOROS_ANTHROPIC_SMOKE_OK',
    temperature: 0,
    maxOutputTokens: 32,
  },
});

if (response.status !== 'drafted') {
  throw new Error(`Anthropic smoke test failed with status ${response.status}; evidence=${response.evidenceReferences.join(',')}`);
}

const actual = response.output.text.trim();
if (actual !== 'AXOROS_ANTHROPIC_SMOKE_OK') {
  throw new Error(`Anthropic smoke test returned unexpected output: ${JSON.stringify(actual)}`);
}

console.log('PASS Anthropic provider connectivity');
console.log(`Provider: ${response.provider}`);
console.log(`Model: ${response.output.model}`);
console.log(`Mode: ${response.mode}`);
console.log(`Input tokens: ${response.output.inputTokens ?? 'not reported'}`);
console.log(`Output tokens: ${response.output.outputTokens ?? 'not reported'}`);
console.log(`Evidence: ${response.evidenceReferences.join(',')}`);
console.log('No client data was used.');
