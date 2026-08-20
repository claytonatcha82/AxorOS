import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AgentRuntimeExecutionRecord } from './agents/agent-runtime-state.js';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';

const SALES_INTAKE_ACTIVATE_PATH = '/api/v1/control/sales-intake/activate';
const SALES_INTAKE_PROCESS_PATH = '/api/v1/control/sales-intake/process';
const MAX_CONTROL_BODY_BYTES = 4 * 1024;

export interface SalesIntakeControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  salesIntakeCommand: {
    activateIntake(executionId: string): Promise<AgentRuntimeExecutionRecord>;
    processIntake(executionId: string): Promise<RuntimeExecutionOutcome>;
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
    if (totalBytes > MAX_CONTROL_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('invalid_json_body');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('invalid_json_body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function validExecutionOnlyBody(body: Record<string, unknown>): body is { executionId: string } {
  const keys = Object.keys(body);
  return keys.length === 1
    && keys[0] === 'executionId'
    && typeof body.executionId === 'string'
    && Boolean(body.executionId.trim());
}

function isSalesIntakePath(path: string | undefined): boolean {
  return path === SALES_INTAKE_ACTIVATE_PATH || path === SALES_INTAKE_PROCESS_PATH;
}

export function createSalesIntakeControlPlaneRequestHandler(
  dependencies: SalesIntakeControlPlaneDependencies,
): RequestListener {
  return async (request, response) => {
    if (!isSalesIntakePath(request.url)) {
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
        error: {
          code,
          message: code === 'request_body_too_large'
            ? 'Request body exceeds the allowed size.'
            : 'Request body must be a JSON object.',
        },
      }, corsHeaders);
      return;
    }

    if (!validExecutionOnlyBody(body)) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: 'invalid_sales_intake_command',
          message: 'Request body must contain only a non-empty executionId.',
        },
      }, corsHeaders);
      return;
    }

    try {
      if (request.url === SALES_INTAKE_ACTIVATE_PATH) {
        const record = await dependencies.salesIntakeCommand.activateIntake(body.executionId);
        sendJson(response, 200, {
          ok: true,
          data: {
            executionId: record.task.executionId,
            status: record.task.status,
            nextAction: record.task.nextAction,
            salesDispatchAuthorised: record.task.inputs.salesDispatchAuthorised,
            outreachAuthorised: record.task.inputs.outreachAuthorised,
          },
        }, corsHeaders);
        return;
      }

      const outcome = await dependencies.salesIntakeCommand.processIntake(body.executionId);
      sendJson(response, 200, {
        ok: true,
        data: {
          executionId: outcome.record.task.executionId,
          status: outcome.record.task.status,
          resultStatus: outcome.record.result?.status ?? null,
          salesDispatchAuthorised: outcome.record.result?.output.salesDispatchAuthorised ?? false,
          outreachAuthorised: outcome.record.result?.output.outreachAuthorised ?? false,
          replayed: outcome.replayed,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sales intake command failed.';
      sendJson(response, 400, { ok: false, error: { code: 'sales_intake_command_rejected', message } }, corsHeaders);
    }
  };
}
