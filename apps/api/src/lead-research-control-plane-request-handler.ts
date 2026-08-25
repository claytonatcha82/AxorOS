import { randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type { LeadLiveResearchRuntime } from './services/lead-live-research-runtime.js';

const LEAD_RESEARCH_PATH = '/api/v1/control/lead/research/run';
const MAX_BODY_BYTES = 4 * 1024;

export interface LeadResearchControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  research: Pick<LeadLiveResearchRuntime, 'research'>;
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

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function boundedInteger(value: unknown, field: string, defaultValue: number, maximum: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

export function createLeadResearchControlPlaneRequestHandler(
  dependencies: LeadResearchControlPlaneDependencies,
): RequestListener {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== LEAD_RESEARCH_PATH) {
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
      const allowed = new Set(['geographicFocus', 'country', 'maxQueries', 'maxBusinessesPerQuery', 'maxWebResultsPerBusiness']);
      if (!Object.keys(body).every((key) => allowed.has(key))) {
        throw new Error('Lead research request contains unsupported fields.');
      }
      const geographicFocus = optionalText(body.geographicFocus, 'geographicFocus', 120) ?? 'South Africa';
      const country = optionalText(body.country, 'country', 80);
      const maxQueries = boundedInteger(body.maxQueries, 'maxQueries', 1, 3);
      const maxBusinessesPerQuery = boundedInteger(body.maxBusinessesPerQuery, 'maxBusinessesPerQuery', 3, 5);
      const maxWebResultsPerBusiness = boundedInteger(body.maxWebResultsPerBusiness, 'maxWebResultsPerBusiness', 3, 5);
      const runId = randomUUID();

      const result = await dependencies.research.research({
        geographicFocus,
        ...(country ? { country } : {}),
        maxQueries,
        maxBusinessesPerQuery,
        maxWebResultsPerBusiness,
        executionId: `lead-research:control:${runId}`,
        correlationId: `lead-research:control:${runId}`,
      });

      sendJson(response, 200, {
        ok: true,
        data: {
          geographicFocus,
          queries: result.queries,
          atlasSourcePaths: result.atlasSourcePaths,
          discovered: result.discovered,
          enriched: result.enriched.map((lead) => ({
            leadId: lead.leadId,
            companyName: lead.companyName,
            officialWebsiteUrl: lead.officialWebsiteUrl,
            suggestedStatus: lead.preliminaryQualification.suggestedStatus,
            recommendedAction: lead.qualificationDisposition.recommendedAction,
            reviewExecutionId: lead.qualificationReviewExecutionId,
          })),
          ambiguousOrUnresolved: result.proposals.length,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lead research failed.';
      const status = /must be|unsupported fields|invalid_json_body|request_body_too_large/.test(message) ? 400 : 500;
      sendJson(response, status, {
        ok: false,
        error: { code: status === 400 ? 'invalid_lead_research_request' : 'lead_research_failed', message },
      }, corsHeaders);
    }
  };
}
