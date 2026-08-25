import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import { validateDeploymentStatusInput, type DeploymentStatusInput, type DeploymentStatusOutput, type DeploymentProviderStatus } from './deployment-provider-contract.js';

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflarePagesDeployment {
  id?: string;
  environment?: string;
  url?: string;
  created_on?: string;
  latest_stage?: { status?: string };
}

export interface CloudflareRollbackIntegrationOptions {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function providerStatus(value: string | undefined): DeploymentProviderStatus {
  switch (value?.toLowerCase()) {
    case 'queued': return 'queued';
    case 'initialize':
    case 'clone_repo':
    case 'build':
    case 'deploy':
    case 'active': return 'building';
    case 'success': return 'ready';
    case 'failure':
    case 'canceled': return 'failed';
    default: return 'unknown';
  }
}

function sanitizeMessage(value: string | undefined, apiToken: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replaceAll(apiToken, '[REDACTED]').slice(0, 500);
}

async function parseEnvelope<T>(response: Response): Promise<CloudflareEnvelope<T>> {
  const body = await response.text();
  if (!body.trim()) return {};
  try {
    return JSON.parse(body) as CloudflareEnvelope<T>;
  } catch {
    return { errors: [{ code: response.status, message: 'Cloudflare returned a non-JSON response.' }] };
  }
}

export function createCloudflareRollbackIntegration(
  options: CloudflareRollbackIntegrationOptions,
): ExternalIntegration<DeploymentStatusInput, DeploymentStatusOutput> {
  const accountId = options.accountId.trim();
  const apiToken = options.apiToken.trim();
  if (!accountId) throw new Error('Cloudflare accountId is required.');
  if (!apiToken) throw new Error('Cloudflare API token is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');

  return {
    integrationId: 'deployment.cloudflare.rollback',
    kind: 'deployment',
    provider: 'cloudflare',
    supportedModes: ['live'],
    supportedOperations: ['rollback_production'],

    async execute(request: IntegrationRequest<DeploymentStatusInput>): Promise<IntegrationResponse<DeploymentStatusOutput>> {
      if (request.requestedBy !== 'production_agent' && request.requestedBy !== 'human_executive') {
        return {
          integrationId: 'deployment.cloudflare.rollback', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'blocked', output: { projectName: '', deploymentId: '', environment: 'production', status: 'unknown' }, evidenceReferences: [], retryable: false,
        };
      }

      const input = request.input;
      if (validateDeploymentStatusInput(input).length > 0) {
        return {
          integrationId: 'deployment.cloudflare.rollback', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'blocked', output: { projectName: input.projectName?.trim() ?? '', deploymentId: input.deploymentId?.trim() ?? '', environment: 'production', status: 'unknown' }, evidenceReferences: [], retryable: false,
        };
      }

      try {
        const response = await fetchImpl(`${baseUrl}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(input.projectName.trim())}/deployments/${encodeURIComponent(input.deploymentId.trim())}/rollback`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        const payload = await parseEnvelope<CloudflarePagesDeployment>(response);
        if (!response.ok || payload.success === false || !payload.result) {
          const error = payload.errors?.[0];
          return {
            integrationId: 'deployment.cloudflare.rollback', operation: request.operation, provider: 'cloudflare', mode: request.mode,
            status: 'failed',
            output: {
              projectName: input.projectName.trim(), deploymentId: input.deploymentId.trim(), environment: 'production', status: 'unknown',
              providerErrorCode: error?.code !== undefined ? String(error.code) : `HTTP_${response.status}`,
              providerErrorMessage: sanitizeMessage(error?.message, apiToken) ?? 'Cloudflare production rollback failed.',
            },
            evidenceReferences: [], retryable: response.status === 429 || response.status >= 500,
          };
        }

        return {
          integrationId: 'deployment.cloudflare.rollback', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'succeeded',
          output: {
            projectName: input.projectName.trim(),
            deploymentId: payload.result.id?.trim() || input.deploymentId.trim(),
            environment: 'production',
            status: providerStatus(payload.result.latest_stage?.status),
            ...(payload.result.url?.trim() ? { url: payload.result.url.trim() } : {}),
            ...(payload.result.created_on?.trim() ? { createdAt: payload.result.created_on.trim() } : {}),
          },
          evidenceReferences: [`cloudflare:pages:rollback:${input.deploymentId.trim()}`], retryable: false,
        };
      } catch {
        return {
          integrationId: 'deployment.cloudflare.rollback', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'failed', output: { projectName: input.projectName.trim(), deploymentId: input.deploymentId.trim(), environment: 'production', status: 'unknown', providerErrorCode: 'NETWORK_ERROR', providerErrorMessage: 'Cloudflare rollback request failed before an HTTP response was received.' },
          evidenceReferences: [], retryable: true,
        };
      }
    },
  };
}
