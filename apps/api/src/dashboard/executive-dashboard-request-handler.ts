import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { authenticateControlPlaneRequest } from '../control-plane-auth.js';
import type { ApiConfig } from '../config.js';
import type { PilotSystemStatePostgresStore } from '../data/pilot-system-state-postgres-store.js';
import { createAgentReadinessServiceFromConfig, type AgentReadinessApiConfig } from './agent-readiness-service.js';
import type { ExecutiveDashboardService } from './executive-dashboard-service.js';

const DASHBOARD_PATH = '/api/v1/control/dashboard/executive';
type DashboardConfig = Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'> & Partial<AgentReadinessApiConfig>;

export interface ExecutiveDashboardRequestHandlerDependencies {
  config: DashboardConfig;
  dashboard: Pick<ExecutiveDashboardService, 'snapshot'>;
  pilotSystemState?: Pick<PilotSystemStatePostgresStore, 'get'>;
  pilotLeadWorkerStatus?: () => {
    inProgress: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
    lastOutcome: 'completed' | 'failed' | 'skipped' | null;
  };
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

export function createExecutiveDashboardRequestHandler(dependencies: ExecutiveDashboardRequestHandlerDependencies): RequestListener {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== DASHBOARD_PATH) {
      dependencies.fallback(request, response);
      return;
    }

    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin === dependencies.config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = dependencies.config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'GET,OPTIONS';
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

    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } }, { allow: 'GET,OPTIONS', ...corsHeaders });
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
      const snapshot = await dependencies.dashboard.snapshot();
      const readiness = createAgentReadinessServiceFromConfig(dependencies.config).snapshot();
      const pilotState = dependencies.pilotSystemState
        ? await dependencies.pilotSystemState.get()
        : {
            state: 'PILOT_DISABLED' as const,
            changedBy: 'system',
            reason: 'Authoritative pilot state store is not connected; fail-closed.',
            version: 0,
            changedAt: snapshot.generatedAt,
          };
      const pilotLeadWorker = dependencies.pilotLeadWorkerStatus
        ? dependencies.pilotLeadWorkerStatus()
        : { inProgress: false, lastStartedAt: null, lastCompletedAt: null, lastFailedAt: null, lastOutcome: null };
      sendJson(response, 200, { ok: true, data: { ...snapshot, agentReadiness: readiness, pilotState, pilotLeadWorker } }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Executive dashboard snapshot failed.';
      sendJson(response, 500, { ok: false, error: { code: 'executive_dashboard_failed', message } }, corsHeaders);
    }
  };
}
