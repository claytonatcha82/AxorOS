import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import type { PilotPendingApproval, PilotRecoveryItem } from './agents/pilot-runtime-operator-command.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';

const PILOT_RUNTIME_EXECUTE_PATH = '/api/v1/control/runtime/execute';
const PILOT_RUNTIME_APPROVAL_RESOLVE_PATH = '/api/v1/control/runtime/approval/resolve';
const PILOT_RUNTIME_PENDING_APPROVALS_PATH = '/api/v1/control/runtime/approvals/pending';
const PILOT_RUNTIME_RECOVERY_PATH = '/api/v1/control/runtime/recovery';
const MAX_CONTROL_BODY_BYTES = 4 * 1024;

export interface PilotRuntimeControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  operatorCommand: {
    listPendingApprovals(limit?: number): Promise<readonly PilotPendingApproval[]>;
    listRecoveryRequired(limit?: number): Promise<readonly PilotRecoveryItem[]>;
    execute(executionId: string, capabilityId: string): Promise<RuntimeExecutionOutcome>;
    resolveApproval(
      executionId: string,
      decision: 'approved' | 'rejected',
      reason?: string,
    ): Promise<RuntimeExecutionOutcome>;
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

async function readCommandBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_CONTROL_BODY_BYTES) throw new Error('request_body_too_large');
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

function isPilotRuntimeControlPath(path: string | undefined): boolean {
  return path === PILOT_RUNTIME_EXECUTE_PATH
    || path === PILOT_RUNTIME_APPROVAL_RESOLVE_PATH
    || path === PILOT_RUNTIME_PENDING_APPROVALS_PATH
    || path === PILOT_RUNTIME_RECOVERY_PATH;
}

function validExecuteBody(body: Record<string, unknown>): body is { executionId: string; capabilityId: string } {
  const keys = Object.keys(body);
  return keys.length === 2
    && keys.every((key) => key === 'executionId' || key === 'capabilityId')
    && typeof body.executionId === 'string'
    && Boolean(body.executionId.trim())
    && typeof body.capabilityId === 'string'
    && Boolean(body.capabilityId.trim());
}

function validApprovalBody(
  body: Record<string, unknown>,
): body is { executionId: string; decision: 'approved' | 'rejected'; reason?: string } {
  const keys = Object.keys(body);
  if (!keys.every((key) => key === 'executionId' || key === 'decision' || key === 'reason')) return false;
  if (!keys.includes('executionId') || !keys.includes('decision')) return false;
  if (typeof body.executionId !== 'string' || !body.executionId.trim()) return false;
  if (body.decision !== 'approved' && body.decision !== 'rejected') return false;
  if (body.reason !== undefined && (typeof body.reason !== 'string' || !body.reason.trim())) return false;
  return true;
}

function outcomeBody(outcome: RuntimeExecutionOutcome): Record<string, unknown> {
  return {
    executionId: outcome.record.task.executionId,
    destinationAgent: outcome.record.task.destinationAgent,
    status: outcome.record.task.status,
    approvalRequired: outcome.record.task.approvalRequired,
    approvalOwner: outcome.record.task.approvalOwner ?? null,
    nextAction: outcome.record.task.nextAction,
    resultStatus: outcome.record.result?.status ?? null,
    replayed: outcome.replayed,
  };
}

export function createPilotRuntimeControlPlaneRequestHandler(
  dependencies: PilotRuntimeControlPlaneDependencies,
): RequestListener {
  return async (request, response) => {
    if (!isPilotRuntimeControlPath(request.url)) {
      dependencies.fallback(request, response);
      return;
    }

    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin === dependencies.config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = dependencies.config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'GET,POST,OPTIONS';
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

    const isReadOnlyList = request.url === PILOT_RUNTIME_PENDING_APPROVALS_PATH
      || request.url === PILOT_RUNTIME_RECOVERY_PATH;
    if ((isReadOnlyList && request.method !== 'GET') || (!isReadOnlyList && request.method !== 'POST')) {
      sendJson(
        response,
        405,
        { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } },
        { allow: isReadOnlyList ? 'GET,OPTIONS' : 'POST,OPTIONS', ...corsHeaders },
      );
      return;
    }

    const auth = authenticateControlPlaneRequest(request.headers.authorization, dependencies.config.controlPlaneToken);
    if (!auth.authenticated) {
      const notConfigured = auth.reason === 'not_configured';
      sendJson(
        response,
        notConfigured ? 503 : 401,
        {
          ok: false,
          error: {
            code: notConfigured ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized',
            message: notConfigured ? 'Control-plane authentication is not configured.' : 'Authentication is required.',
          },
        },
        { ...(notConfigured ? {} : { 'www-authenticate': 'Bearer' }), ...corsHeaders },
      );
      return;
    }

    if (request.url === PILOT_RUNTIME_PENDING_APPROVALS_PATH) {
      try {
        const approvals = await dependencies.operatorCommand.listPendingApprovals();
        sendJson(response, 200, { ok: true, data: { approvals } }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Pending approval listing failed.';
        sendJson(response, 400, { ok: false, error: { code: 'runtime_pending_approvals_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (request.url === PILOT_RUNTIME_RECOVERY_PATH) {
      try {
        const recovery = await dependencies.operatorCommand.listRecoveryRequired();
        sendJson(response, 200, { ok: true, data: { recovery } }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Runtime recovery listing failed.';
        sendJson(response, 400, { ok: false, error: { code: 'runtime_recovery_listing_rejected', message } }, corsHeaders);
      }
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readCommandBody(request);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_json_body';
      sendJson(
        response,
        code === 'request_body_too_large' ? 413 : 400,
        { ok: false, error: { code, message: code === 'request_body_too_large' ? 'Request body exceeds the allowed size.' : 'Request body must be a JSON object.' } },
        corsHeaders,
      );
      return;
    }

    if (request.url === PILOT_RUNTIME_EXECUTE_PATH) {
      if (!validExecuteBody(body)) {
        sendJson(response, 400, { ok: false, error: { code: 'invalid_runtime_execute_command', message: 'Request body must contain only non-empty executionId and capabilityId.' } }, corsHeaders);
        return;
      }
      try {
        const outcome = await dependencies.operatorCommand.execute(body.executionId, body.capabilityId);
        sendJson(response, 200, { ok: true, data: outcomeBody(outcome) }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Runtime execute command failed.';
        sendJson(response, 400, { ok: false, error: { code: 'runtime_execute_command_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (!validApprovalBody(body)) {
      sendJson(response, 400, { ok: false, error: { code: 'invalid_runtime_approval_command', message: 'Request body must contain executionId, approved/rejected decision, and optionally a non-empty reason.' } }, corsHeaders);
      return;
    }
    try {
      const outcome = await dependencies.operatorCommand.resolveApproval(body.executionId, body.decision, body.reason);
      sendJson(response, 200, { ok: true, data: outcomeBody(outcome) }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Runtime approval command failed.';
      sendJson(response, 400, { ok: false, error: { code: 'runtime_approval_command_rejected', message } }, corsHeaders);
    }
  };
}
