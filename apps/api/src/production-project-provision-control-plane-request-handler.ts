import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ApiConfig } from './config.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import {
  executeGovernedPreviewProjectProvision,
  type GovernedPreviewProjectProvisionDependencies,
} from './agents/production-preview-provisioning-command.js';

const PATH = '/api/v1/control/production/deployment/project';
const MAX_BODY_BYTES = 8 * 1024;

export interface ProductionProjectProvisionControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  provisionDependencies: GovernedPreviewProjectProvisionDependencies;
  executeProvision?: typeof executeGovernedPreviewProjectProvision;
  fallback: RequestListener;
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
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
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_json_body') throw error;
    throw new Error('invalid_json_body');
  }
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

export function createProductionProjectProvisionControlPlaneRequestHandler(
  dependencies: ProductionProjectProvisionControlPlaneDependencies,
): RequestListener {
  const executeProvision = dependencies.executeProvision ?? executeGovernedPreviewProjectProvision;

  return async (request, response) => {
    if (request.url !== PATH) {
      dependencies.fallback(request, response);
      return;
    }

    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin === dependencies.config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = dependencies.config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'POST,OPTIONS';
      corsHeaders['access-control-allow-headers'] = 'authorization,content-type,x-request-id';
    }

    if (request.method === 'OPTIONS') {
      if (origin && origin !== dependencies.config.controlCenterUrl) {
        sendJson(response, 403, { ok: false, error: { code: 'cors_origin_denied', message: 'Origin is not allowed.' } }, corsHeaders);
        return;
      }
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } }, { allow: 'POST,OPTIONS', ...corsHeaders });
      return;
    }

    const auth = authenticateControlPlaneRequest(request.headers.authorization, dependencies.config.controlPlaneToken);
    if (!auth.authenticated) {
      const unavailable = auth.reason === 'not_configured';
      sendJson(response, unavailable ? 503 : 401, {
        ok: false,
        error: {
          code: unavailable ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized',
          message: unavailable ? 'Control-plane authentication is not configured.' : 'Authentication is required.',
        },
      }, { ...(unavailable ? {} : { 'www-authenticate': 'Bearer' }), ...corsHeaders });
      return;
    }

    try {
      const body = await readBody(request);
      const allowed = new Set([
        'commercialRecordReference', 'financeClearanceId', 'operationsReadinessId', 'projectName',
        'productionBranch', 'executionId', 'correlationId', 'idempotencyKey',
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('unexpected_field');

      const executionId = optionalString(body, 'executionId') ?? randomUUID();
      const correlationId = optionalString(body, 'correlationId') ?? randomUUID();
      const projectName = requiredString(body, 'projectName');
      const productionBranch = requiredString(body, 'productionBranch');

      const result = await executeProvision({
        commercialRecordReference: requiredString(body, 'commercialRecordReference'),
        financeClearanceId: requiredString(body, 'financeClearanceId'),
        operationsReadinessId: requiredString(body, 'operationsReadinessId'),
        integrationRequest: {
          integrationId: 'deployment.cloudflare.project',
          operation: 'create_project',
          requestedBy: 'human_executive',
          executionId,
          correlationId,
          mode: 'live',
          risk: 'high',
          idempotencyKey: requiredString(body, 'idempotencyKey'),
          input: { projectName, productionBranch },
        },
      }, dependencies.provisionDependencies);

      sendJson(response, 200, {
        ok: true,
        data: {
          project: result.output,
          evidenceReferences: result.evidenceReferences,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Production project provisioning failed.';
      const status = message === 'request_body_too_large' ? 413 : 400;
      sendJson(response, status, {
        ok: false,
        error: { code: 'production_project_provision_rejected', message },
      }, corsHeaders);
    }
  };
}
