import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type { PilotSystemState, PilotSystemStatePostgresStore } from './data/pilot-system-state-postgres-store.js';

const PATH = '/api/v1/control/pilot/state';

type Config = Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;

export interface PilotSystemStateControlPlaneDependencies {
  config: Config;
  store: Pick<PilotSystemStatePostgresStore, 'get' | 'set'>;
  fallback: RequestListener;
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createPilotSystemStateControlPlaneRequestHandler(dependencies: PilotSystemStateControlPlaneDependencies): RequestListener {
  return async (request, response) => {
    if (request.url !== PATH) return dependencies.fallback(request, response);

    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin === dependencies.config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = dependencies.config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'GET,POST,OPTIONS';
      corsHeaders['access-control-allow-headers'] = 'authorization,content-type,x-request-id';
    }
    if (request.method === 'OPTIONS') {
      if (origin && origin !== dependencies.config.controlCenterUrl) return sendJson(response, 403, { ok: false, error: { code: 'cors_origin_denied', message: 'Origin is not allowed.' } }, corsHeaders);
      response.writeHead(204, corsHeaders); response.end(); return;
    }

    const auth = authenticateControlPlaneRequest(request.headers.authorization, dependencies.config.controlPlaneToken);
    if (!auth.authenticated) {
      const unavailable = auth.reason === 'not_configured';
      return sendJson(response, unavailable ? 503 : 401, { ok: false, error: { code: unavailable ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized', message: unavailable ? 'Control-plane authentication is not configured.' : 'Authentication is required.' } }, corsHeaders);
    }

    try {
      if (request.method === 'GET') return sendJson(response, 200, { ok: true, data: await dependencies.store.get() }, corsHeaders);
      if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } }, { allow: 'GET,POST,OPTIONS', ...corsHeaders });

      const body = await readBody(request) as Record<string, unknown>;
      const state = body.state;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const confirmation = body.confirmation;
      if (state !== 'PILOT_DISABLED' && state !== 'PILOT_ACTIVE') return sendJson(response, 400, { ok: false, error: { code: 'invalid_pilot_state', message: 'State must be PILOT_DISABLED or PILOT_ACTIVE.' } }, corsHeaders);
      if (!reason) return sendJson(response, 400, { ok: false, error: { code: 'pilot_state_reason_required', message: 'A Human Executive reason is required.' } }, corsHeaders);
      if (state === 'PILOT_ACTIVE' && confirmation !== 'ACTIVATE PILOT') return sendJson(response, 409, { ok: false, error: { code: 'pilot_activation_confirmation_required', message: 'Pilot activation requires the exact confirmation ACTIVATE PILOT.' } }, corsHeaders);

      const updated = await dependencies.store.set(state as PilotSystemState, 'human_executive', reason);
      return sendJson(response, 200, { ok: true, data: updated }, corsHeaders);
    } catch (error) {
      return sendJson(response, 500, { ok: false, error: { code: 'pilot_system_state_failed', message: error instanceof Error ? error.message : 'Pilot system state operation failed.' } }, corsHeaders);
    }
  };
}
