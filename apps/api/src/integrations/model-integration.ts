import type { IntegrationRequest, IntegrationResponse } from './integration-contract.js';

export interface ModelGenerationInput {
  prompt: string;
  systemInstruction?: string;
  context?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ModelGenerationOutput {
  text: string;
  model: string;
  finishReason: 'stop' | 'length' | 'blocked' | 'unknown';
  inputTokens?: number;
  outputTokens?: number;
}

export type ModelGenerationRequest = IntegrationRequest<ModelGenerationInput>;
export type ModelGenerationResponse = IntegrationResponse<ModelGenerationOutput>;

export function validateModelGenerationInput(input: ModelGenerationInput): string[] {
  const errors: string[] = [];
  if (!input.prompt.trim()) errors.push('model prompt is required.');
  if (input.temperature !== undefined && (input.temperature < 0 || input.temperature > 2)) {
    errors.push('model temperature must be between 0 and 2.');
  }
  if (input.maxOutputTokens !== undefined && (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)) {
    errors.push('model maxOutputTokens must be a positive integer.');
  }
  return errors;
}
