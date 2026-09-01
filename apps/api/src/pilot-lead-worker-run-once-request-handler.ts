import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type { AtlasLeadResearchOutput } from './services/lead-atlas-research-orchestrator.js';

const RUN_ONCE_PATH = '/api/v1/control/pilot/lead-worker/run-once';
const MAX_BODY_BYTES = 1024;
const EXACT_CONFIRMATION = 'RUN PILOT LEAD CYCLE';

export interface PilotLeadWorkerRunOnceDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  worker: { runOnce(): Promise<AtlasLeadResearchOutput | null> };
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
  if (!chunks.length) throw new Error('invalid_json_body');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_json_body') throw error;
    throw new Error('invalid_json_body');
  }
}

export function createPilotLeadWorkerRunOnceRequestHandler(
  dependencies: PilotLeadWorkerRunOnceDependencies,
): RequestListener {
  return async (request, response) => {
    if (request.url !== RUN_ONCE_PATH) {
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

    let body: Record<string, unknown>;
    try {
      body = await readBody(request);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_json_body';
      sendJson(response, code === 'request_body_too_large' ? 413 : 400, {
        ok: false,
        error: { code, message: code === 'request_body_too_large' ? 'Request body exceeds the allowed size.' : 'Request body must be a JSON object.' },
      }, corsHeaders);
      return;
    }

    if (Object.keys(body).length !== 1 || body.confirmation !== EXACT_CONFIRMATION) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: 'pilot_lead_cycle_confirmation_required',
          message: `Exact confirmation "${EXACT_CONFIRMATION}" is required.`,
        },
      }, corsHeaders);
      return;
    }

    try {
      const result = await dependencies.worker.runOnce();
      if (!result) {
        sendJson(response, 409, {
          ok: false,
          error: {
            code: 'pilot_lead_cycle_not_executed',
            message: 'Pilot Lead cycle did not execute because the pilot is disabled or a cycle is already in progress.',
          },
        }, corsHeaders);
        return;
      }

      sendJson(response, 200, {
        ok: true,
        data: {
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
          duplicateSkipped: result.outcomes.duplicateSkipped,
          webResearchFailed: result.outcomes.webResearchFailed,
          candidateOutcomes: result.outcomes,
        },
      }, corsHeaders);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: {
          code: 'pilot_lead_cycle_failed',
          message: error instanceof Error ? error.message : 'Pilot Lead cycle failed.',
        },
      }, corsHeaders);
    }
  };
}
