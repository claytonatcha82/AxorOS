import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  createPilotActivationCommand,
  type PilotActivationCommandInput,
  type PilotActivationCommandResult,
} from './agents/pilot-activation-command.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type { PilotSystemStatePostgresStore } from './data/pilot-system-state-postgres-store.js';

const PATH = '/api/v1/control/pilot/state';
type Config = Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;

type PilotStateStore = Pick<PilotSystemStatePostgresStore, 'get' | 'set' | 'getActivationReadiness'>;

export interface PilotSystemStateControlPlaneDependencies {
  config: Config;
  store: PilotStateStore;
  activationCommand?: {
    activate(input: PilotActivationCommandInput): Promise<PilotActivationCommandResult>;
  };
  fallback: RequestListener;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
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
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 4 * 1024) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

export function createPilotSystemStateControlPlaneRequestHandler(
  dependencies: PilotSystemStateControlPlaneDependencies,
): RequestListener {
  const activationCommand = dependencies.activationCommand ?? createPilotActivationCommand({
    readinessStore: { get: (readinessId) => dependencies.store.getActivationReadiness(readinessId) },
    pilotStateStore: dependencies.store,
  });

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
      if (origin && origin !== dependencies.config.controlCenterUrl) {
        return sendJson(response, 403, { ok: false, error: { code: 'cors_origin_denied', message: 'Origin is not allowed.' } }, corsHeaders);
      }
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const auth = authenticateControlPlaneRequest(request.headers.authorization, dependencies.config.controlPlaneToken);
    if (!auth.authenticated) {
      const unavailable = auth.reason === 'not_configured';
      return sendJson(
        response,
        unavailable ? 503 : 401,
        {
          ok: false,
          error: {
            code: unavailable ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized',
            message: unavailable ? 'Control-plane authentication is not configured.' : 'Authentication is required.',
          },
        },
        corsHeaders,
      );
    }

    try {
      if (request.method === 'GET') {
        return sendJson(response, 200, { ok: true, data: await dependencies.store.get() }, corsHeaders);
      }
      if (request.method !== 'POST') {
        return sendJson(
          response,
          405,
          { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } },
          { allow: 'GET,POST,OPTIONS', ...corsHeaders },
        );
      }

      const body = await readBody(request);
      const state = body.state;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (state !== 'PILOT_DISABLED' && state !== 'PILOT_ACTIVE') {
        return sendJson(response, 400, { ok: false, error: { code: 'invalid_pilot_state', message: 'State must be PILOT_DISABLED or PILOT_ACTIVE.' } }, corsHeaders);
      }
      if (!reason) {
        return sendJson(response, 400, { ok: false, error: { code: 'pilot_state_reason_required', message: 'A Human Executive reason is required.' } }, corsHeaders);
      }

      if (state === 'PILOT_ACTIVE') {
        if (body.confirmation !== 'ACTIVATE PILOT') {
          return sendJson(response, 409, { ok: false, error: { code: 'pilot_activation_confirmation_required', message: 'Pilot activation requires the exact confirmation ACTIVATE PILOT.' } }, corsHeaders);
        }
        const readinessId = typeof body.readinessId === 'string' ? body.readinessId.trim() : '';
        if (!readinessId) {
          return sendJson(response, 400, { ok: false, error: { code: 'pilot_activation_readiness_id_required', message: 'A persisted pilot activation readiness ID is required.' } }, corsHeaders);
        }
        try {
          const activated = await activationCommand.activate({
            readinessId,
            actor: 'human_executive',
            reason,
          });
          return sendJson(response, 200, { ok: true, data: activated }, corsHeaders);
        } catch (error) {
          return sendJson(response, 409, {
            ok: false,
            error: {
              code: 'pilot_activation_readiness_blocked',
              message: error instanceof Error ? error.message : 'Pilot activation readiness gate rejected activation.',
            },
          }, corsHeaders);
        }
      }

      const updated = await dependencies.store.set('PILOT_DISABLED', 'human_executive', reason);
      return sendJson(response, 200, { ok: true, data: updated }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pilot system state operation failed.';
      const badBody = message === 'request_body_too_large' || message === 'invalid_json_body' || error instanceof SyntaxError;
      return sendJson(
        response,
        message === 'request_body_too_large' ? 413 : badBody ? 400 : 500,
        {
          ok: false,
          error: {
            code: message === 'request_body_too_large' ? 'request_body_too_large' : badBody ? 'invalid_json_body' : 'pilot_system_state_failed',
            message: message === 'request_body_too_large' ? 'Request body exceeds the allowed size.' : badBody ? 'Request body must be a JSON object.' : message,
          },
        },
        corsHeaders,
      );
    }
  };
}
