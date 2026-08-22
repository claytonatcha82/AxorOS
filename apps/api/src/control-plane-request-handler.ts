import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import type {
  OperationsProductionReadinessAssessment,
  OperationsProductionReadinessWorkflowResult,
} from './agents/operations-production-readiness-workflow.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';

const PRODUCTION_EXECUTE_PATH = '/api/v1/control/production/execute';
const OPERATIONS_PRODUCTION_READINESS_ASSESS_PATH = '/api/v1/control/operations/production-readiness/assess';
const LEAD_QUALIFICATION_REVIEW_REQUEST_PATH = '/api/v1/control/lead-qualification-review/request';
const LEAD_QUALIFICATION_REVIEW_RESOLVE_PATH = '/api/v1/control/lead-qualification-review/resolve';
const MAX_CONTROL_BODY_BYTES = 4 * 1024;

export interface ControlPlaneRequestHandlerDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  productionCommand: {
    execute(executionId: string): Promise<RuntimeExecutionOutcome>;
  };
  operationsProductionReadinessCommand?: {
    assess(assessment: OperationsProductionReadinessAssessment): Promise<OperationsProductionReadinessWorkflowResult>;
  };
  leadQualificationReviewCommand?: {
    requestReview(executionId: string): Promise<RuntimeExecutionOutcome>;
    resolveReview(executionId: string, decision: 'approved' | 'rejected', reason?: string): Promise<RuntimeExecutionOutcome>;
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('invalid_json_body');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function isControlPath(path: string | undefined): boolean {
  return path === PRODUCTION_EXECUTE_PATH
    || path === OPERATIONS_PRODUCTION_READINESS_ASSESS_PATH
    || path === LEAD_QUALIFICATION_REVIEW_REQUEST_PATH
    || path === LEAD_QUALIFICATION_REVIEW_RESOLVE_PATH;
}

function validExecutionOnlyBody(body: Record<string, unknown>): body is { executionId: string } {
  const keys = Object.keys(body);
  return keys.length === 1
    && keys[0] === 'executionId'
    && typeof body.executionId === 'string'
    && Boolean(body.executionId.trim());
}

function validOperationsProductionReadinessBody(
  body: Record<string, unknown>,
): body is Record<string, unknown> & OperationsProductionReadinessAssessment {
  const allowed = new Set([
    'readinessId',
    'commercialRecordReference',
    'contractSigned',
    'onboardingComplete',
    'assetsAvailable',
    'planningComplete',
    'evidenceReferences',
    'assessedAt',
  ]);
  const keys = Object.keys(body);
  if (keys.length !== allowed.size || !keys.every((key) => allowed.has(key))) return false;
  if (typeof body.readinessId !== 'string' || !body.readinessId.trim()) return false;
  if (typeof body.commercialRecordReference !== 'string' || !body.commercialRecordReference.trim()) return false;
  if (typeof body.contractSigned !== 'boolean') return false;
  if (typeof body.onboardingComplete !== 'boolean') return false;
  if (typeof body.assetsAvailable !== 'boolean') return false;
  if (typeof body.planningComplete !== 'boolean') return false;
  if (!Array.isArray(body.evidenceReferences)
    || body.evidenceReferences.length === 0
    || !body.evidenceReferences.every((reference) => typeof reference === 'string' && Boolean(reference.trim()))) return false;
  if (typeof body.assessedAt !== 'string' || Number.isNaN(Date.parse(body.assessedAt))) return false;
  return true;
}

function validLeadReviewResolutionBody(
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

export function createControlPlaneRequestHandler(
  dependencies: ControlPlaneRequestHandlerDependencies,
): RequestListener {
  return async (request, response) => {
    if (!isControlPath(request.url)) {
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

    const auth = authenticateControlPlaneRequest(
      request.headers.authorization,
      dependencies.config.controlPlaneToken,
    );
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

    if (request.url === PRODUCTION_EXECUTE_PATH) {
      if (!validExecutionOnlyBody(body)) {
        sendJson(response, 400, { ok: false, error: { code: 'invalid_production_command', message: 'Request body must contain only a non-empty executionId.' } }, corsHeaders);
        return;
      }

      try {
        const outcome = await dependencies.productionCommand.execute(body.executionId);
        sendJson(response, 200, {
          ok: true,
          data: {
            executionId: outcome.record.task.executionId,
            status: outcome.record.task.status,
            resultStatus: outcome.record.result?.status ?? null,
            replayed: outcome.replayed,
          },
        }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Production command failed.';
        sendJson(response, 400, { ok: false, error: { code: 'production_command_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (request.url === OPERATIONS_PRODUCTION_READINESS_ASSESS_PATH) {
      const readinessCommand = dependencies.operationsProductionReadinessCommand;
      if (!readinessCommand) {
        sendJson(response, 503, {
          ok: false,
          error: {
            code: 'operations_production_readiness_not_configured',
            message: 'Operations production-readiness control is not configured.',
          },
        }, corsHeaders);
        return;
      }
      if (!validOperationsProductionReadinessBody(body)) {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'invalid_operations_production_readiness_command',
            message: 'Request body must contain only the complete governed Operations production-readiness assessment.',
          },
        }, corsHeaders);
        return;
      }

      try {
        const result = await readinessCommand.assess(body);
        sendJson(response, 200, {
          ok: true,
          data: {
            readinessId: result.decision.readinessId,
            commercialRecordReference: result.decision.commercialRecordReference,
            state: result.decision.state,
            persistence: result.persistence,
          },
        }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Operations production-readiness assessment failed.';
        sendJson(response, 400, {
          ok: false,
          error: { code: 'operations_production_readiness_rejected', message },
        }, corsHeaders);
      }
      return;
    }

    const reviewCommand = dependencies.leadQualificationReviewCommand;
    if (!reviewCommand) {
      sendJson(response, 503, { ok: false, error: { code: 'lead_qualification_review_not_configured', message: 'Lead qualification review control is not configured.' } }, corsHeaders);
      return;
    }

    if (request.url === LEAD_QUALIFICATION_REVIEW_REQUEST_PATH) {
      if (!validExecutionOnlyBody(body)) {
        sendJson(response, 400, { ok: false, error: { code: 'invalid_lead_qualification_review_request', message: 'Request body must contain only a non-empty executionId.' } }, corsHeaders);
        return;
      }

      try {
        const outcome = await reviewCommand.requestReview(body.executionId);
        sendJson(response, 200, {
          ok: true,
          data: {
            executionId: outcome.record.task.executionId,
            status: outcome.record.task.status,
            approvalRequired: outcome.record.task.approvalRequired,
            approvalOwner: outcome.record.task.approvalOwner ?? null,
            nextAction: outcome.record.task.nextAction,
            replayed: outcome.replayed,
          },
        }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Lead qualification review request failed.';
        sendJson(response, 400, { ok: false, error: { code: 'lead_qualification_review_request_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (!validLeadReviewResolutionBody(body)) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: 'invalid_lead_qualification_review_resolution',
          message: 'Request body must contain executionId, approved/rejected decision, and optionally a non-empty reason.',
        },
      }, corsHeaders);
      return;
    }

    try {
      const outcome = await reviewCommand.resolveReview(body.executionId, body.decision, body.reason);
      sendJson(response, 200, {
        ok: true,
        data: {
          executionId: outcome.record.task.executionId,
          status: outcome.record.task.status,
          approvalRequired: outcome.record.task.approvalRequired,
          nextAction: outcome.record.task.nextAction,
          replayed: outcome.replayed,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lead qualification review resolution failed.';
      sendJson(response, 400, { ok: false, error: { code: 'lead_qualification_review_resolution_rejected', message } }, corsHeaders);
    }
  };
}
