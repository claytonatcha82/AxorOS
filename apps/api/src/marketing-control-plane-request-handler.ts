import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type { MarketingRuntimeCommandService } from './agents/marketing-runtime-command-service.js';

const MARKETING_DRAFT_PATH = '/api/v1/control/marketing/draft';
const MAX_BODY_BYTES = 8 * 1024;

export interface MarketingControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  marketing: Pick<MarketingRuntimeCommandService, 'draft'>;
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
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field, maxLength);
}

export function createMarketingControlPlaneRequestHandler(dependencies: MarketingControlPlaneDependencies): RequestListener {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== MARKETING_DRAFT_PATH) {
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
      const notConfigured = auth.reason === 'not_configured';
      sendJson(response, notConfigured ? 503 : 401, {
        ok: false,
        error: {
          code: notConfigured ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized',
          message: notConfigured ? 'Control-plane authentication is not configured.' : 'Authentication is required.',
        },
      }, { ...(notConfigured ? {} : { 'www-authenticate': 'Bearer' }), ...corsHeaders });
      return;
    }

    try {
      const body = await readBody(request);
      const allowed = new Set(['brief', 'objective']);
      if (!Object.keys(body).every((key) => allowed.has(key))) throw new Error('Marketing draft request contains unsupported fields.');
      const brief = requiredText(body.brief, 'brief', 4_000);
      const objective = optionalText(body.objective, 'objective', 500);
      const outcome = await dependencies.marketing.draft({ brief, ...(objective ? { objective } : {}) });
      sendJson(response, 200, {
        ok: true,
        data: {
          executionId: outcome.record.task.executionId,
          status: outcome.record.task.status,
          resultStatus: outcome.record.result?.status,
          output: outcome.record.result?.output,
          knowledgeReferences: outcome.record.result?.knowledgeReferences ?? outcome.record.task.knowledgeReferences,
          publicationAuthorized: false,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Marketing draft failed.';
      const status = /must be|unsupported fields|invalid_json_body|request_body_too_large|required/.test(message) ? 400 : 500;
      sendJson(response, status, {
        ok: false,
        error: { code: status === 400 ? 'invalid_marketing_draft_request' : 'marketing_draft_failed', message },
      }, corsHeaders);
    }
  };
}
