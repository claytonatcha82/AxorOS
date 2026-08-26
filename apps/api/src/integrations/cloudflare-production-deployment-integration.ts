import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import type { DeploymentAsset, DeploymentProviderStatus, DeploymentStatusOutput } from './deployment-provider-contract.js';

export interface CloudflareProductionDeploymentInput {
  projectName: string;
  productionBranch: string;
  assets: DeploymentAsset[];
  buildOutputDirectory?: string;
  commitHash?: string;
  commitMessage?: string;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareUploadToken { jwt?: string; }
interface CloudflarePagesDeployment {
  id?: string;
  environment?: string;
  url?: string;
  created_on?: string;
  latest_stage?: { status?: string };
}

export interface CloudflareProductionDeploymentIntegrationOptions {
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

function validateInput(input: CloudflareProductionDeploymentInput): string[] {
  const errors: string[] = [];
  if (!input.projectName?.trim()) errors.push('projectName is required.');
  if (!input.productionBranch?.trim()) errors.push('productionBranch is required.');
  if (!Array.isArray(input.assets) || input.assets.length === 0) {
    errors.push('assets must contain at least one file.');
    return errors;
  }
  if (input.assets.length > 20000) errors.push('assets cannot exceed 20000 files.');
  const seenPaths = new Set<string>();
  for (const asset of input.assets) {
    const path = asset.path?.trim();
    if (!path || !path.startsWith('/') || path.includes('..')) errors.push('asset path must be an absolute safe deployment path.');
    if (path && seenPaths.has(path)) errors.push(`duplicate asset path: ${path}.`);
    if (path) seenPaths.add(path);
    if (!/^[a-f0-9]{32}$/i.test(asset.contentHash?.trim() ?? '')) errors.push(`asset ${path || '<unknown>'} has an invalid contentHash.`);
    if (!asset.contentType?.trim()) errors.push(`asset ${path || '<unknown>'} contentType is required.`);
    if (!asset.contentBase64?.trim()) errors.push(`asset ${path || '<unknown>'} contentBase64 is required.`);
  }
  return errors;
}

function providerFailure(
  request: IntegrationRequest<CloudflareProductionDeploymentInput>,
  message: string,
  responseStatus: number,
  errorCode?: number,
): IntegrationResponse<DeploymentStatusOutput> {
  return {
    integrationId: 'deployment.cloudflare.production',
    operation: request.operation,
    provider: 'cloudflare',
    mode: request.mode,
    status: 'failed',
    output: {
      projectName: request.input.projectName.trim(),
      deploymentId: '',
      environment: 'production',
      status: 'unknown',
      providerErrorCode: errorCode !== undefined ? String(errorCode) : `HTTP_${responseStatus}`,
      providerErrorMessage: message,
    },
    evidenceReferences: [],
    retryable: responseStatus === 429 || responseStatus >= 500,
  };
}

export function createCloudflareProductionDeploymentIntegration(
  options: CloudflareProductionDeploymentIntegrationOptions,
): ExternalIntegration<CloudflareProductionDeploymentInput, DeploymentStatusOutput> {
  const accountId = options.accountId.trim();
  const apiToken = options.apiToken.trim();
  if (!accountId) throw new Error('Cloudflare accountId is required.');
  if (!apiToken) throw new Error('Cloudflare API token is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');

  return {
    integrationId: 'deployment.cloudflare.production',
    kind: 'deployment',
    provider: 'cloudflare',
    supportedModes: ['live'],
    supportedOperations: ['deploy_production'],

    async execute(request: IntegrationRequest<CloudflareProductionDeploymentInput>): Promise<IntegrationResponse<DeploymentStatusOutput>> {
      if (request.requestedBy !== 'production_agent' && request.requestedBy !== 'human_executive') {
        return {
          integrationId: 'deployment.cloudflare.production', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'blocked', output: { projectName: '', deploymentId: '', environment: 'production', status: 'unknown' }, evidenceReferences: [], retryable: false,
        };
      }
      if (request.operation !== 'deploy_production' || validateInput(request.input).length > 0) {
        return {
          integrationId: 'deployment.cloudflare.production', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'blocked', output: { projectName: request.input.projectName?.trim() ?? '', deploymentId: '', environment: 'production', status: 'unknown' }, evidenceReferences: [], retryable: false,
        };
      }

      const input = request.input;
      try {
        const tokenResponse = await fetchImpl(`${baseUrl}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(input.projectName.trim())}/upload-token`, {
          headers: { Authorization: `Bearer ${apiToken}` },
        });
        const tokenPayload = await parseEnvelope<CloudflareUploadToken>(tokenResponse);
        const uploadJwt = tokenPayload.result?.jwt?.trim();
        if (!tokenResponse.ok || tokenPayload.success === false || !uploadJwt) {
          const error = tokenPayload.errors?.[0];
          return providerFailure(request, sanitizeMessage(error?.message, apiToken) ?? 'Cloudflare upload token request failed.', tokenResponse.status, error?.code);
        }

        const hashes = input.assets.map((asset) => asset.contentHash.trim());
        const missingResponse = await fetchImpl(`${baseUrl}/pages/assets/check-missing`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${uploadJwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes }),
        });
        const missingPayload = await parseEnvelope<string[]>(missingResponse);
        if (!missingResponse.ok || missingPayload.success === false || !Array.isArray(missingPayload.result)) {
          const error = missingPayload.errors?.[0];
          return providerFailure(request, sanitizeMessage(error?.message, apiToken) ?? 'Cloudflare missing-assets check failed.', missingResponse.status, error?.code);
        }

        const missing = new Set(missingPayload.result);
        const assetsToUpload = input.assets.filter((asset) => missing.has(asset.contentHash.trim()));
        if (assetsToUpload.length > 0) {
          const uploadResponse = await fetchImpl(`${baseUrl}/pages/assets/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${uploadJwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(assetsToUpload.map((asset) => ({
              key: asset.contentHash.trim(),
              value: asset.contentBase64,
              base64: true,
              metadata: { contentType: asset.contentType.trim() },
            }))),
          });
          const uploadPayload = await parseEnvelope<unknown>(uploadResponse);
          if (!uploadResponse.ok || uploadPayload.success === false) {
            const error = uploadPayload.errors?.[0];
            return providerFailure(request, sanitizeMessage(error?.message, apiToken) ?? 'Cloudflare asset upload failed.', uploadResponse.status, error?.code);
          }
        }

        const manifest = Object.fromEntries(input.assets.map((asset) => [asset.path.trim(), asset.contentHash.trim()]));
        const form = new FormData();
        form.set('branch', input.productionBranch.trim());
        form.set('commit_dirty', 'false');
        form.set('manifest', JSON.stringify(manifest));
        form.set('pages_build_output_dir', input.buildOutputDirectory?.trim() || 'dist');
        if (input.commitHash?.trim()) form.set('commit_hash', input.commitHash.trim());
        if (input.commitMessage?.trim()) form.set('commit_message', input.commitMessage.trim());

        const deployResponse = await fetchImpl(`${baseUrl}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(input.projectName.trim())}/deployments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}` },
          body: form,
        });
        const deployPayload = await parseEnvelope<CloudflarePagesDeployment>(deployResponse);
        if (!deployResponse.ok || deployPayload.success === false || !deployPayload.result?.id?.trim()) {
          const error = deployPayload.errors?.[0];
          return providerFailure(request, sanitizeMessage(error?.message, apiToken) ?? 'Cloudflare production deployment failed.', deployResponse.status, error?.code);
        }

        const deployment = deployPayload.result;
        if (deployment.environment && deployment.environment !== 'production') {
          return providerFailure(request, 'Cloudflare did not classify the deployment as production.', 409);
        }

        return {
          integrationId: 'deployment.cloudflare.production', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'succeeded',
          output: {
            projectName: input.projectName.trim(), deploymentId: deployment.id!.trim(), environment: 'production',
            status: providerStatus(deployment.latest_stage?.status),
            ...(deployment.url?.trim() ? { url: deployment.url.trim() } : {}),
            ...(deployment.created_on?.trim() ? { createdAt: deployment.created_on.trim() } : {}),
          },
          evidenceReferences: [`cloudflare:pages:production:${deployment.id!.trim()}`], retryable: false,
        };
      } catch {
        return {
          integrationId: 'deployment.cloudflare.production', operation: request.operation, provider: 'cloudflare', mode: request.mode,
          status: 'failed',
          output: { projectName: input.projectName.trim(), deploymentId: '', environment: 'production', status: 'unknown', providerErrorCode: 'NETWORK_ERROR', providerErrorMessage: 'Cloudflare production deployment request failed before completion.' },
          evidenceReferences: [], retryable: true,
        };
      }
    },
  };
}
