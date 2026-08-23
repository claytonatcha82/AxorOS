import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { CommercialPaymentGate } from './data/commercial-payment-requirement-postgres-store.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type {
  FinanceGovernedControlAssessmentInput,
  FinanceGovernedControlBindInput,
} from './agents/finance-governed-control-command.js';

const FINANCE_ASSESS_PATH = '/api/v1/control/finance/payment/assess';
const FINANCE_BIND_PATH = '/api/v1/control/finance/payment/bind';
const MAX_CONTROL_BODY_BYTES = 4 * 1024;
const GATES: CommercialPaymentGate[] = ['PRODUCTION_START', 'MILESTONE_RELEASE', 'FINAL_HANDOVER'];

export interface FinanceControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  financeCommand: {
    assess(input: FinanceGovernedControlAssessmentInput): Promise<{
      decision: { commercialRecordReference: string; gate: CommercialPaymentGate; state: string; reason: string };
      auditEventReference: string;
    }>;
    bind(input: FinanceGovernedControlBindInput): Promise<{
      before: { state: string };
      beforeAuditEventReference: string;
      clearanceId: string;
      satisfactionPersistence: 'accepted' | 'duplicate' | 'not_satisfied';
      after: { state: string };
      afterAuditEventReference: string;
    }>;
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
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new Error('invalid_json_body'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function validGate(value: unknown): value is CommercialPaymentGate {
  return typeof value === 'string' && GATES.includes(value as CommercialPaymentGate);
}

function validAssessmentBody(body: Record<string, unknown>): body is Record<string, unknown> & FinanceGovernedControlAssessmentInput {
  const allowed = new Set(['commercialRecordReference', 'gate', 'provider', 'providerPaymentReference']);
  const keys = Object.keys(body);
  return keys.length === allowed.size
    && keys.every((key) => allowed.has(key))
    && nonEmptyText(body.commercialRecordReference)
    && validGate(body.gate)
    && nonEmptyText(body.provider)
    && nonEmptyText(body.providerPaymentReference);
}

function validBindBody(body: Record<string, unknown>): body is Record<string, unknown> & FinanceGovernedControlBindInput {
  const allowed = new Set([
    'commercialRecordReference',
    'gate',
    'provider',
    'providerPaymentReference',
    'trustedPaymentWebhookIdempotencyKey',
  ]);
  const keys = Object.keys(body);
  return keys.length === allowed.size
    && keys.every((key) => allowed.has(key))
    && nonEmptyText(body.commercialRecordReference)
    && validGate(body.gate)
    && nonEmptyText(body.provider)
    && nonEmptyText(body.providerPaymentReference)
    && nonEmptyText(body.trustedPaymentWebhookIdempotencyKey);
}

function isFinancePath(path: string | undefined): boolean {
  return path === FINANCE_ASSESS_PATH || path === FINANCE_BIND_PATH;
}

export function createFinanceControlPlaneRequestHandler(dependencies: FinanceControlPlaneDependencies): RequestListener {
  return async (request, response) => {
    if (!isFinancePath(request.url)) {
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
      sendJson(
        response,
        notConfigured ? 503 : 401,
        { ok: false, error: { code: notConfigured ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized', message: notConfigured ? 'Control-plane authentication is not configured.' : 'Authentication is required.' } },
        { ...(notConfigured ? {} : { 'www-authenticate': 'Bearer' }), ...corsHeaders },
      );
      return;
    }

    let body: Record<string, unknown>;
    try { body = await readBody(request); } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_json_body';
      sendJson(response, code === 'request_body_too_large' ? 413 : 400, { ok: false, error: { code, message: code === 'request_body_too_large' ? 'Request body exceeds the allowed size.' : 'Request body must be a JSON object.' } }, corsHeaders);
      return;
    }

    if (request.url === FINANCE_ASSESS_PATH) {
      if (!validAssessmentBody(body)) {
        sendJson(response, 400, { ok: false, error: { code: 'invalid_finance_assessment_command', message: 'Request body must contain only commercialRecordReference, approved gate, provider, and providerPaymentReference.' } }, corsHeaders);
        return;
      }
      try {
        const result = await dependencies.financeCommand.assess(body);
        sendJson(response, 200, {
          ok: true,
          data: {
            commercialRecordReference: result.decision.commercialRecordReference,
            gate: result.decision.gate,
            state: result.decision.state,
            reason: result.decision.reason,
            auditEventReference: result.auditEventReference,
          },
        }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Finance assessment failed.';
        sendJson(response, 400, { ok: false, error: { code: 'finance_assessment_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (!validBindBody(body)) {
      sendJson(response, 400, { ok: false, error: { code: 'invalid_finance_binding_command', message: 'Request body must contain only commercialRecordReference, approved gate, provider, providerPaymentReference, and trustedPaymentWebhookIdempotencyKey. Authority fields are not accepted.' } }, corsHeaders);
      return;
    }

    try {
      const result = await dependencies.financeCommand.bind(body);
      sendJson(response, 200, {
        ok: true,
        data: {
          beforeState: result.before.state,
          beforeAuditEventReference: result.beforeAuditEventReference,
          clearanceId: result.clearanceId,
          satisfactionPersistence: result.satisfactionPersistence,
          state: result.after.state,
          afterAuditEventReference: result.afterAuditEventReference,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Finance binding failed.';
      sendJson(response, 400, { ok: false, error: { code: 'finance_binding_rejected', message } }, corsHeaders);
    }
  };
}
