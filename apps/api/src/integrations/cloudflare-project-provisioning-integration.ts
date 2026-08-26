import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import {
  validateDeploymentProjectProvisionInput,
  type DeploymentProjectOutput,
  type DeploymentProjectProvisionInput,
} from './deployment-provider-contract.js';

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflarePagesProject {
  name?: string;
  production_branch?: string;
  subdomain?: string;
}

export interface CloudflareProjectProvisioningIntegrationOptions {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
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

export function createCloudflareProjectProvisioningIntegration(
  options: CloudflareProjectProvisioningIntegrationOptions,
): ExternalIntegration<DeploymentProjectProvisionInput, DeploymentProjectOutput> {
  const accountId = options.accountId.trim();
  const apiToken = options.apiToken.trim();
  if (!accountId) throw new Error('Cloudflare accountId is required.');
  if (!apiToken) throw new Error('Cloudflare API token is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');

  return {
    integrationId: 'deployment.cloudflare.project',
    kind: 'deployment',
    provider: 'cloudflare',
    supportedModes: ['live'],
    supportedOperations: ['create_project'],

    async execute(request: IntegrationRequest<DeploymentProjectProvisionInput>): Promise<IntegrationResponse<DeploymentProjectOutput>> {
      if (request.requestedBy !== 'production_agent' && request.requestedBy !== 'human_executive') {
        return {
          integrationId: 'deployment.cloudflare.project', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'blocked', output: { projectName: '' }, evidenceReferences: [], retryable: false,
        };
      }

      const input = request.input;
      if (validateDeploymentProjectProvisionInput(input).length > 0) {
        return {
          integrationId: 'deployment.cloudflare.project', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'blocked', output: { projectName: input.projectName?.trim() ?? '' }, evidenceReferences: [], retryable: false,
        };
      }

      try {
        const response = await fetchImpl(`${baseUrl}/accounts/${encodeURIComponent(accountId)}/pages/projects`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.projectName.trim(), production_branch: input.productionBranch.trim() }),
        });
        const payload = await parseEnvelope<CloudflarePagesProject>(response);
        if (!response.ok || payload.success === false || !payload.result) {
          const error = payload.errors?.[0];
          return {
            integrationId: 'deployment.cloudflare.project', operation: request.operation, provider: 'cloudflare', mode: request.mode,
            status: 'failed',
            output: {
              projectName: input.projectName.trim(),
              providerErrorCode: error?.code !== undefined ? String(error.code) : `HTTP_${response.status}`,
              providerErrorMessage: sanitizeMessage(error?.message, apiToken) ?? 'Cloudflare Pages project creation failed.',
            },
            evidenceReferences: [], retryable: response.status === 429 || response.status >= 500,
          };
        }

        return {
          integrationId: 'deployment.cloudflare.project', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'succeeded',
          output: {
            projectName: payload.result.name?.trim() || input.projectName.trim(),
            productionBranch: payload.result.production_branch?.trim() || input.productionBranch.trim(),
            ...(payload.result.subdomain?.trim() ? { productionUrl: payload.result.subdomain.trim() } : {}),
          },
          evidenceReferences: [`cloudflare:pages:project:${input.projectName.trim()}`], retryable: false,
        };
      } catch {
        return {
          integrationId: 'deployment.cloudflare.project', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'failed', output: { projectName: input.projectName.trim(), providerErrorCode: 'NETWORK_ERROR', providerErrorMessage: 'Cloudflare project creation request failed before an HTTP response was received.' },
          evidenceReferences: [], retryable: true,
        };
      }
    },
  };
}
