import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ApiConfig } from './config.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import {
  executeGovernedPreviewBuildDeployment,
  type GovernedPreviewBuildDeploymentRequest,
  type GovernedPreviewBuildDeploymentResult,
} from './agents/production-preview-build-deployment-command.js';
import type { GovernedPreviewDeploymentDependencies } from './agents/production-preview-deployment-command.js';

const PATH = '/api/v1/control/production/deployment/preview';
const MAX_BODY_BYTES = 16 * 1024;

export interface ProductionPreviewControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  previewDependencies: GovernedPreviewDeploymentDependencies;
  executePreview?: typeof executeGovernedPreviewBuildDeployment;
  fallback: RequestListener;
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('invalid_json_body');
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${key}`);
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${key}`);
  return value.trim();
}

function parseCommand(body: Record<string, unknown>): GovernedPreviewBuildDeploymentRequest {
  const allowed = new Set(['commercialRecordReference','financeClearanceId','operationsReadinessId','projectName','productionBranch','previewBranch','buildOutputDirectory','executionId','correlationId','idempotencyKey','commitHash','commitMessage']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('unexpected_field');
  return {
    commercialRecordReference: requiredString(body, 'commercialRecordReference'),
    financeClearanceId: requiredString(body, 'financeClearanceId'),
    operationsReadinessId: requiredString(body, 'operationsReadinessId'),
    projectName: requiredString(body, 'projectName'),
    productionBranch: requiredString(body, 'productionBranch'),
    previewBranch: requiredString(body, 'previewBranch'),
    buildOutputDirectory: requiredString(body, 'buildOutputDirectory'),
    executionId: optionalString(body, 'executionId') ?? randomUUID(),
    correlationId: optionalString(body, 'correlationId') ?? randomUUID(),
    idempotencyKey: requiredString(body, 'idempotencyKey'),
    requestedBy: 'human_executive',
    ...(optionalString(body, 'commitHash') ? { commitHash: optionalString(body, 'commitHash') } : {}),
    ...(optionalString(body, 'commitMessage') ? { commitMessage: optionalString(body, 'commitMessage') } : {}),
  };
}

function resultBody(result: GovernedPreviewBuildDeploymentResult): Record<string, unknown> {
  return {
    deployment: result.deployment.output,
    evidenceReferences: result.deployment.evidenceReferences,
    packagedFileCount: result.packagedFileCount,
    packagedBytes: result.packagedBytes,
  };
}

export function createProductionPreviewControlPlaneRequestHandler(dependencies: ProductionPreviewControlPlaneDependencies): RequestListener {
  const executePreview = dependencies.executePreview ?? executeGovernedPreviewBuildDeployment;
  return async (request, response) => {
    if (request.url !== PATH) return dependencies.fallback(request, response);
    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin === dependencies.config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = dependencies.config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'POST,OPTIONS';
      corsHeaders['access-control-allow-headers'] = 'authorization,content-type,x-request-id';
    }
    if (request.method === 'OPTIONS') {
      if (origin && origin !== dependencies.config.controlCenterUrl) return sendJson(response, 403, { ok: false, error: { code: 'cors_origin_denied', message: 'Origin is not allowed.' } }, corsHeaders);
      response.writeHead(204, corsHeaders); response.end(); return;
    }
    if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } }, { allow: 'POST,OPTIONS', ...corsHeaders });
    const auth = authenticateControlPlaneRequest(request.headers.authorization, dependencies.config.controlPlaneToken);
    if (!auth.authenticated) {
      const unavailable = auth.reason === 'not_configured';
      return sendJson(response, unavailable ? 503 : 401, { ok: false, error: { code: unavailable ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized', message: unavailable ? 'Control-plane authentication is not configured.' : 'Authentication is required.' } }, corsHeaders);
    }
    try {
      const body = await readBody(request);
      const command = parseCommand(body);
      const result = await executePreview(command, dependencies.previewDependencies);
      sendJson(response, 200, { ok: true, data: resultBody(result) }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Production preview deployment failed.';
      const status = message === 'request_body_too_large' ? 413 : 400;
      sendJson(response, status, { ok: false, error: { code: 'production_preview_deployment_rejected', message } }, corsHeaders);
    }
  };
}
