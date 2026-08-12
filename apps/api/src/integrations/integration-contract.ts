import type { CoreAgentId } from '../agents/agent-runtime-contract.js';

export type IntegrationKind = 'model' | 'email' | 'payment' | 'deployment' | 'storage' | 'webhook' | 'other';
export type IntegrationMode = 'sandbox' | 'draft' | 'live';
export type IntegrationRisk = 'low' | 'medium' | 'high' | 'critical';

export interface IntegrationRequest<TInput = Record<string, unknown>> {
  integrationId: string;
  operation: string;
  requestedBy: CoreAgentId | 'human_executive';
  executionId: string;
  correlationId: string;
  mode: IntegrationMode;
  risk: IntegrationRisk;
  input: TInput;
  idempotencyKey?: string;
}

export interface IntegrationResponse<TOutput = Record<string, unknown>> {
  integrationId: string;
  operation: string;
  provider: string;
  mode: IntegrationMode;
  status: 'succeeded' | 'drafted' | 'blocked' | 'failed';
  output: TOutput;
  externalReference?: string;
  evidenceReferences: string[];
  retryable: boolean;
}

export interface ExternalIntegration<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> {
  integrationId: string;
  kind: IntegrationKind;
  provider: string;
  supportedModes: readonly IntegrationMode[];
  supportedOperations: readonly string[];
  execute(request: IntegrationRequest<TInput>): Promise<IntegrationResponse<TOutput>>;
}

export function validateIntegrationRequest(request: IntegrationRequest): string[] {
  const errors: string[] = [];
  if (!request.integrationId.trim()) errors.push('integrationId is required.');
  if (!request.operation.trim()) errors.push('operation is required.');
  if (!request.executionId.trim()) errors.push('executionId is required.');
  if (!request.correlationId.trim()) errors.push('correlationId is required.');
  if (request.mode === 'live' && request.risk !== 'low' && !request.idempotencyKey?.trim()) {
    errors.push('live medium/high/critical integration requests require an idempotencyKey.');
  }
  return errors;
}
